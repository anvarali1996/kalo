import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { POST as signIn } from "@/app/api/auth/login/route";
import { GET as authStatus } from "@/app/api/auth/me/route";
import { POST as signOut } from "@/app/api/auth/logout/route";
import { GET as accountState } from "@/app/api/state/route";
import { POST as addDiaryEntry } from "@/app/api/diary/route";
import { GET as adminUsers } from "@/app/api/admin/users/route";
import { GET as scanCredits } from "@/app/api/ai/credits/route";
import { COOKIE_NAME, hashToken } from "@/lib/server-auth";

type BatchQuery = { toSQL(): { sql: string; params: unknown[] } };
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>> & { batch(queries: BatchQuery[]): Promise<void> };
let sessionToken: string | undefined;
let userId: string;

vi.mock("@/db", () => ({ database: () => db, hasDatabase: () => true }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => name === COOKIE_NAME && sessionToken ? { value: sessionToken } : undefined,
  }),
}));

const credentials = { email: "existing-user@example.test", password: "fixture-password" };
const origin = "https://kalo.example.test";

function post(path: string, data: object) {
  return new NextRequest(origin + path, {
    method: "POST",
    headers: { origin, "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

beforeAll(async () => {
  pg = new PGlite();
  const baseline = await readFile(new URL("../drizzle/0000_existing_schema.sql", import.meta.url), "utf8");
  await pg.exec(baseline);
  db = Object.assign(drizzle(pg, { schema }), {
    async batch(queries: BatchQuery[]) {
      // Execute the production batch's SQL against the local PostgreSQL fixture.
      await pg.transaction(async tx => {
        for (const query of queries) {
          const { sql, params } = query.toSQL();
          await tx.query(sql, params);
        }
      });
    },
  });
  const [user] = await db.insert(schema.users)
    .values({ name: "Existing account", email: credentials.email, passwordHash: await bcrypt.hash(credentials.password, 4) })
    .returning({ id: schema.users.id });
  userId = user.id;
  await pg.query(
    "INSERT INTO diary_entries (user_id, date, name, grams, kcal, source) VALUES ($1, '2026-11-18', 'Existing meal', 100, 140, 'manual')",
    [user.id],
  );
});

beforeEach(async () => {
  sessionToken = undefined;
  vi.stubEnv("KALO_ADMIN_USER_IDS", "");
  await pg.query("DELETE FROM sessions WHERE user_id = $1", [userId]);
});
afterEach(() => { vi.unstubAllEnvs(); });
afterAll(async () => { await pg.close(); });

async function login() {
  const response = await signIn(post("/api/auth/login", credentials));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ user: { id: userId, email: credentials.email } });
  sessionToken = response.cookies.get(COOKIE_NAME)?.value;
  expect(sessionToken).toBeTruthy();
  return sessionToken!;
}

describe("Accounts on the database schema before AI scanning", () => {
  it("signs in and loads the existing diary", async () => {
    await login();
    const response = await accountState();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      diary: [{ name: "Existing meal", grams: 100, kcal: 140, source: "manual" }],
    });
  });

  it("saves a barcode entry to the signed-in user's diary", async () => {
    await login();
    const entry = {
      date: "2026-11-18", name: "Barcode product", barcode: "3017620422003", grams: 80, kcal: 400,
      protein: 4, carbs: 30, fat: 20, image: null, source: "off",
    };
    const response = await addDiaryEntry(post("/api/diary", entry));
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ entry });
  });
});

describe("One active account session", () => {
  it("denies the previous device as soon as the second device signs in", async () => {
    const first = await login();
    const second = await login();
    expect(first).not.toBe(second);
    sessionToken = first;
    expect(await (await authStatus()).json()).toMatchObject({ user: null });
    expect((await accountState()).status).toBe(401);
    await signOut(post("/api/auth/logout", {}));

    sessionToken = second;
    expect((await accountState()).status).toBe(200);
    const { rows } = await pg.query("SELECT token_hash FROM sessions WHERE user_id = $1", [userId]);
    expect(rows).toEqual([{ token_hash: hashToken(second) }]);
  });

  it("keeps one active session after simultaneous sign-ins", async () => {
    const responses = await Promise.all([
      signIn(post("/api/auth/login", credentials)),
      signIn(post("/api/auth/login", credentials)),
    ]);
    expect(responses.map(response => response.status)).toEqual([200, 200]);
    const statuses = [];
    for (const response of responses) {
      sessionToken = response.cookies.get(COOKIE_NAME)?.value;
      statuses.push((await accountState()).status);
    }
    expect(statuses.sort()).toEqual([200, 401]);
  });

  it("does not reactivate an older token when logging out from a pre-update session", async () => {
    const old = "pre-update-first-device";
    const latest = "pre-update-second-device";
    await pg.query(`
      INSERT INTO sessions (user_id, token_hash, created_at, expires_at) VALUES
      ($1, $2, now() - interval '2 hours', now() + interval '2 days'),
      ($1, $3, now() - interval '1 hour', now() + interval '2 days')
    `, [userId, hashToken(old), hashToken(latest)]);
    sessionToken = old;
    expect((await accountState()).status).toBe(401);
    sessionToken = latest;
    expect((await accountState()).status).toBe(200);
    expect((await signOut(post("/api/auth/logout", {}))).status).toBe(200);
    sessionToken = old;
    expect((await accountState()).status).toBe(401);
  });
});

describe("Admin access and scanner setup before the AI migration", () => {
  const adminRequest = (search = "") => new NextRequest(`${origin}/api/admin/users?search=${encodeURIComponent(search)}`);

  it("rejects guests and ordinary accounts", async () => {
    expect((await adminUsers(adminRequest())).status).toBe(401);
    await login();
    expect((await adminUsers(adminRequest())).status).toBe(403);
  });

  it("lists safe account fields and missing scanner schema only for an authorized admin", async () => {
    vi.stubEnv("KALO_ADMIN_USER_IDS", userId);
    await login();
    expect(await (await authStatus()).json()).toMatchObject({ user: { id: userId, isAdmin: true } });
    const response = await adminUsers(adminRequest("EXISTING-USER"));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      total: 1,
      scannerSetup: { database: false },
      users: [expect.objectContaining({
        id: userId, name: "Existing account", email: credentials.email, createdAt: expect.any(String),
        sessionStartedAt: expect.any(String), scanCredits: null,
      })],
    });
    const { users } = await (await adminUsers(adminRequest())).json();
    expect(Object.keys(users[0]).sort()).toEqual(["createdAt", "email", "id", "name", "scanCredits", "sessionStartedAt"]);
    expect(await (await adminUsers(adminRequest("%"))).json()).toMatchObject({ total: 0, users: [] });
  });

  it("identifies missing scanner storage without disrupting normal account access", async () => {
    await login();
    const response = await scanCredits(new NextRequest(`${origin}/api/ai/credits`));
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "aiStorageUnavailable" });
    expect((await accountState()).status).toBe(200);
  });
});
