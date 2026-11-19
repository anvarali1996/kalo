import { randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { createSession, COOKIE_NAME, hashToken } from "@/lib/server-auth";
import { migrateTestDatabase, testBatch } from "./database-helpers";

const jobs = vi.hoisted(() => [] as (() => Promise<void>)[]);
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>> & { batch: ReturnType<typeof testBatch> };
let sessionToken: string | undefined;
let userId: string;
let originalHash: string;
const origin = "https://kalo.example.test";
const email = "existing-user@example.test";
const original = "old-fixture-password";
const replacement = "new-fixture-password";
const emails = vi.fn();

vi.mock("@/db", () => ({ database: () => db, hasDatabase: () => true }));
vi.mock("next/headers", () => ({ cookies: async () => ({
  get: (name: string) => name === COOKIE_NAME && sessionToken ? { value: sessionToken } : undefined,
}) }));
vi.mock("next/server", async original => ({
  ...await original<typeof import("next/server")>(),
  after: (job: () => Promise<void>) => jobs.push(job),
}));

import { POST as forgot } from "@/app/api/auth/forgot-password/route";
import { POST as reset } from "@/app/api/auth/reset-password/route";
import { POST as change } from "@/app/api/auth/change-password/route";
import { GET as signedIn } from "@/app/api/auth/me/route";
import { POST as login } from "@/app/api/auth/login/route";

const post = (path: string, input: object, requestOrigin = origin) => new NextRequest(`${origin}/api/auth/${path}`, {
  method: "POST", headers: { origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(input),
});
const runJobs = async () => { for (const job of jobs.splice(0)) await job(); };
const passwordHash = async () => (await pg.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id=$1", [userId])).rows[0].password_hash;
const sessionCount = async () => (await pg.query("SELECT id FROM sessions WHERE user_id=$1", [userId])).rows.length;
async function createToken() {
  const token = randomBytes(32).toString("base64url");
  await pg.query("SELECT kalo_issue_password_reset($1,$2)", [userId, hashToken(token)]);
  return token;
}
async function currentSession() {
  sessionToken = "fixture-current-session";
  await pg.query(`INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES
    ($1,$2,now()-interval '1 hour',now()+interval '1 day'),
    ($1,$3,now(),now()+interval '1 day')`, [userId, hashToken("old-device-session"), hashToken(sessionToken)]);
}

beforeAll(async () => {
  pg = new PGlite();
  await migrateTestDatabase(pg);
  db = Object.assign(drizzle(pg, { schema }), { batch: testBatch(pg) });
  originalHash = await bcrypt.hash(original, 4);
});
beforeEach(async () => {
  vi.stubEnv("APP_URL", origin);
  vi.stubEnv("VERCEL", "0");
  vi.stubEnv("RESEND_API_KEY", "fixture_resend_key");
  vi.stubEnv("RESEND_FROM_EMAIL", "accounts@example.test");
  emails.mockReset().mockImplementation(async () => Response.json({ id: "email_fixture" }));
  vi.stubGlobal("fetch", emails);
  jobs.length = 0;
  sessionToken = undefined;
  await pg.exec("TRUNCATE users, auth_rate_limits CASCADE");
  const [user] = await db.insert(schema.users).values({ name: "Test user", email, passwordHash: originalHash }).returning();
  userId = user.id;
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await pg.close(); });

it("acknowledges existing and unknown emails identically and sends a localized, hashed-token reset link", async () => {
  const missing = await forgot(post("forgot-password", { email: "unknown@example.test", locale: "uz" }));
  const existing = await forgot(post("forgot-password", { email: email.toUpperCase(), locale: "uz" }));
  expect(missing.status).toBe(202);
  expect(existing.status).toBe(202);
  expect(await existing.json()).toEqual(await missing.json());
  expect(emails).not.toHaveBeenCalled();
  await runJobs();
  expect(emails).toHaveBeenCalledOnce();
  const [url, options] = emails.mock.calls[0] as [string, RequestInit];
  expect(url).toBe("https://api.resend.com/emails");
  const body = JSON.parse(String(options.body));
  expect(body.to).toEqual([email]);
  expect(body.subject).toContain("Parolni tiklash");
  const link = new URL(body.text.match(/https:\/\/\S+/)[0]);
  expect(link.origin).toBe(origin);
  expect(link.pathname).toBe("/reset-password");
  expect(link.search).toBe("");
  const fragment = new URLSearchParams(link.hash.slice(1));
  const token = fragment.get("token")!;
  expect(fragment.get("lang")).toBe("uz");
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  const [stored] = (await pg.query<{ token_hash: string; ttl: string }>(
    "SELECT token_hash, extract(epoch FROM (expires_at - now())) AS ttl FROM password_reset_tokens",
  )).rows;
  expect(stored.token_hash).toBe(hashToken(token));
  expect(Number(stored.ttl)).toBeGreaterThan(1790);
  expect(Number(stored.ttl)).toBeLessThanOrEqual(1800);
});

it("rate-limits reset emails per inbox and rejects cross-origin requests without sending", async () => {
  const input = { email, locale: "en" };
  expect((await forgot(post("forgot-password", input, "https://third-party.test"))).status).toBe(403);
  for (let i = 0; i < 4; i++) {
    const response = await forgot(post("forgot-password", input));
    expect(response.status).toBe(202);
    await runJobs();
  }
  expect(emails).toHaveBeenCalledTimes(3);
  expect((await pg.query("SELECT user_id FROM password_reset_tokens")).rows).toHaveLength(1);
});

it("releases no credentials for expired and superseded tokens and rate-limits brute-force attempts", async () => {
  const previous = await createToken();
  const latest = await createToken();
  expect((await reset(post("reset-password", { token: previous, password: replacement }))).status).toBe(400);
  await pg.exec("UPDATE password_reset_tokens SET expires_at=now()-interval '1 second'");
  expect((await reset(post("reset-password", { token: latest, password: replacement }))).status).toBe(400);
  for (let i = 0; i < 18; i++) {
    expect((await reset(post("reset-password", { token: latest, password: replacement }))).status).toBe(400);
  }
  expect((await reset(post("reset-password", { token: latest, password: replacement }))).status).toBe(429);
  expect(await passwordHash()).toBe(originalHash);
});

it("redeems a reset link once under concurrent requests and revokes all sessions", async () => {
  await currentSession();
  const token = await createToken();
  const responses = await Promise.all([0, 1].map(() => reset(post("reset-password", { token, password: replacement }))));
  expect(responses.map(response => response.status).sort()).toEqual([200, 400]);
  expect(await bcrypt.compare(replacement, await passwordHash())).toBe(true);
  expect(await sessionCount()).toBe(0);
  expect((await pg.query("SELECT user_id FROM password_reset_tokens")).rows).toHaveLength(0);
  expect(await (await signedIn()).json()).toMatchObject({ user: null });
  expect((await login(post("login", { email, password: original }))).status).toBe(401);
  expect((await login(post("login", { email, password: replacement }))).status).toBe(200);
});

it("changes the password only with current credentials, invalidating outstanding tokens and raced sign-ins", async () => {
  const input = { currentPassword: original, password: replacement };
  expect((await change(post("change-password", input))).status).toBe(401);
  await currentSession();
  const token = await createToken();
  expect((await change(post("change-password", { ...input, currentPassword: "incorrect-password" }))).status).toBe(400);
  expect(await sessionCount()).toBe(2);
  const updated = await change(post("change-password", input));
  expect(updated.status).toBe(200);
  expect(updated.headers.get("set-cookie")).toContain("Max-Age=0");
  expect(await sessionCount()).toBe(0);
  expect((await reset(post("reset-password", { token, password: original }))).status).toBe(400);
  expect(await createSession(userId, originalHash)).toBeNull();
  expect(await sessionCount()).toBe(0);
});

it("rejects passwords above bcrypt's byte limit before consuming a reset token", async () => {
  const token = await createToken();
  const response = await reset(post("reset-password", { token, password: "ā".repeat(37) }));
  expect(response.status).toBe(400);
  expect((await pg.query("SELECT token_hash FROM password_reset_tokens")).rows).toEqual([{ token_hash: hashToken(token) }]);
});
