import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import bcrypt from "bcryptjs";
import { drizzle } from "drizzle-orm/pglite";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import * as schema from "@/db/schema";
import { POST as signIn } from "@/app/api/auth/login/route";
import { GET as accountState } from "@/app/api/state/route";
import { POST as addDiaryEntry } from "@/app/api/diary/route";
import { COOKIE_NAME } from "@/lib/server-auth";

let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
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
  db = drizzle(pg, { schema });
  const [user] = await db.insert(schema.users)
    .values({ name: "Existing account", email: credentials.email, passwordHash: await bcrypt.hash(credentials.password, 4) })
    .returning({ id: schema.users.id });
  userId = user.id;
  await pg.query(
    "INSERT INTO diary_entries (user_id, date, name, grams, kcal, source) VALUES ($1, '2026-11-18', 'Existing meal', 100, 140, 'manual')",
    [user.id],
  );
});

beforeEach(() => { sessionToken = undefined; });
afterAll(async () => { await pg.close(); });

async function login() {
  const response = await signIn(post("/api/auth/login", credentials));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ user: { id: userId, email: credentials.email } });
  sessionToken = response.cookies.get(COOKIE_NAME)?.value;
  expect(sessionToken).toBeTruthy();
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
