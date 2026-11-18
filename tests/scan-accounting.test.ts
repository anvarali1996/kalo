import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createTestUser, estimate } from "./database-helpers";

let db: PGlite;
let user: string;
let preserved: { credits: number; diaryCount: number; welcomeCount: number };
const hash = "a".repeat(64);

async function outcome(query: string, args: unknown[]) {
  const { rows } = await db.query<{ value: Record<string, unknown> }>(query, args);
  return rows[0].value;
}
const begin = (id = randomUUID(), token = randomUUID(), owner = user, inputHash = hash) =>
  outcome("SELECT kalo_begin_scan($1, $2, $3, $4) AS value", [owner, id, inputHash, token]);
const complete = (id: string, token: string, owner = user, result = estimate) =>
  outcome("SELECT kalo_complete_scan($1, $2, $3, $4::jsonb) AS value", [owner, id, token, JSON.stringify(result)]);
const fail = (id: string, token: string) => db.query("SELECT kalo_fail_scan($1, $2, $3)", [user, id, token]);
const balance = async (owner = user) => (await db.query<{ credits: number }>("SELECT credits FROM scan_accounts WHERE user_id=$1", [owner])).rows[0].credits;
const purchase = (id: string, owner = user) => outcome("SELECT kalo_start_purchase($1,$2) AS value", [owner, id]);
const pay = (id: string, event = `evt_${randomUUID()}`, session = `cs_${id}`, intent = `pi_${id}`, amount = 499, currency = "eur", owner = user) =>
  outcome("SELECT kalo_credit_purchase($1,$2,$3,$4,$5,$6,$7,$8) AS value", [owner, id, session, intent, event, "checkout.session.completed", amount, currency]);
const save = (id: string, portions = [100, 200], owner = user) =>
  outcome("SELECT kalo_save_ai_scan($1,$2,$3,$4::jsonb) AS value", [owner, id, "2026-11-18", JSON.stringify(portions)]);

beforeAll(async () => {
  db = new PGlite();
  const baseline = await readFile(new URL("../drizzle/0000_existing_schema.sql", import.meta.url), "utf8");
  const migration = await readFile(new URL("../drizzle/0001_ai_scans_and_payments.sql", import.meta.url), "utf8");
  await db.exec(baseline);
  const existing = await createTestUser(db);
  await db.query("INSERT INTO diary_entries (user_id,date,name,grams,kcal,source) VALUES ($1,'2026-11-17','Existing meal',100,200,'manual')", [existing]);
  // Existing db:push installations may already have every baseline table/index/FK.
  await db.exec(baseline);
  await db.exec(`BEGIN; ${migration} COMMIT;`);
  preserved = { credits: await balance(existing),
    diaryCount: (await db.query<{ count: number }>("SELECT count(*)::int AS count FROM diary_entries")).rows[0].count,
    welcomeCount: (await db.query<{ count: number }>("SELECT count(*)::int AS count FROM scan_credit_transactions")).rows[0].count,
  };
});
beforeEach(async () => { await db.exec("TRUNCATE users, stripe_webhook_events CASCADE"); user = await createTestUser(db); });
afterAll(async () => { await db.close(); });

describe("Safe migrations and welcome credits", () => {
  it("preserves an existing diary and grants the existing user exactly five credits", () => {
    expect(preserved).toEqual({ credits: 5, diaryCount: 1, welcomeCount: 1 });
  });
  it("grants five credits and one ledger entry to newly registered users", async () => {
    expect(await balance()).toBe(5);
    const { rows } = await db.query("SELECT delta,balance_after,kind FROM scan_credit_transactions WHERE user_id=$1", [user]);
    expect(rows).toEqual([{ delta: 5, balance_after: 5, kind: "welcome" }]);
  });
});

describe("Successful scan accounting", () => {
  it("holds a single scan slot without deducting, then charges exactly once on success", async () => {
    const id = randomUUID(), token = randomUUID();
    expect((await begin(id, token)).status).toBe("started");
    expect(await balance()).toBe(5);
    expect((await begin()).status).toBe("busy");
    expect((await complete(id, token)).credits).toBe(4);
    const duplicate = await Promise.all([complete(id, token), complete(id, token), begin(id, token)]);
    expect(duplicate.every(r => r.status === "succeeded" && r.credits === 4)).toBe(true);
    expect(await balance()).toBe(4);
    const { rows } = await db.query("SELECT sum(delta)::int AS total,count(*)::int AS count FROM scan_credit_transactions WHERE user_id=$1", [user]);
    expect(rows[0]).toEqual({ total: 4, count: 2 });
  });
  it("never charges failures or invalid/non-food responses", async () => {
    const id = randomUUID(), token = randomUUID();
    await begin(id, token);
    await expect(complete(id, token, user, { ...estimate, containsFood: false, foods: [] })).rejects.toThrow();
    await fail(id, token); await fail(id, token);
    expect(await balance()).toBe(5);
    expect((await begin(id, token)).status).toBe("failed");
  });
  it("serializes queued concurrent starts into one active scan", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => begin()));
    expect(results.filter(r => r.status === "started")).toHaveLength(1);
    expect(results.filter(r => r.status === "busy")).toHaveLength(7);
    expect(await balance()).toBe(5);
  });
  it("stops after five successes and enforces a nonnegative balance in PostgreSQL", async () => {
    for (let i = 0; i < 5; i++) { const id = randomUUID(), token = randomUUID(); await begin(id, token); await complete(id, token); }
    expect((await begin()).status).toBe("no_credits");
    expect(await balance()).toBe(0);
    await expect(db.query("UPDATE scan_accounts SET credits=-1 WHERE user_id=$1", [user])).rejects.toThrow();
    expect(await balance()).toBe(0);
  });
  it("rejects stale completions and releases abandoned leases without charging", async () => {
    const id = randomUUID(), token = randomUUID();
    await begin(id, token);
    expect((await complete(id, randomUUID())).status).toBe("expired");
    await db.query("UPDATE ai_scans SET lease_expires_at=now()-interval '1 second' WHERE id=$1", [id]);
    expect((await complete(id, token)).status).toBe("expired");
    expect((await begin()).status).toBe("started");
    expect(await balance()).toBe(5);
    expect((await complete(id, token)).status).toBe("expired");
  });
  it("binds an idempotency key to the user, image and locale digest", async () => {
    const id = randomUUID(), token = randomUUID(), other = await createTestUser(db);
    await begin(id, token);
    expect((await begin(id, token, user, "b".repeat(64))).status).toBe("conflict");
    expect((await begin(id, token, other)).status).toBe("conflict");
    expect((await complete(id, token, other)).status).toBe("conflict");
    expect(await balance(other)).toBe(5);
  });
  it("limits failed-photo abuse without spending credits", async () => {
    for (let i = 0; i < 30; i++) { const id = randomUUID(), token = randomUUID(); await begin(id, token); await fail(id, token); }
    expect((await begin()).status).toBe("rate_limited");
    expect(await balance()).toBe(5);
  });
});

describe("Stripe purchase accounting and webhook idempotency", () => {
  it("makes repeated checkout requests idempotent and user-bound", async () => {
    const id = randomUUID();
    expect((await purchase(id)).status).toBe("pending");
    expect((await purchase(id)).status).toBe("pending");
    expect((await purchase(id, await createTestUser(db))).status).toBe("conflict");
    expect((await db.query("SELECT * FROM scan_purchases")).rows).toHaveLength(1);
  });
  it("grants once across repeated events and different event IDs for the same session", async () => {
    const id = randomUUID(), event = "evt_one";
    await purchase(id);
    expect((await pay(id, event)).status).toBe("credited");
    expect((await pay(id, event)).status).toBe("duplicate");
    expect((await pay(id, "evt_two")).status).toBe("duplicate");
    expect(await balance()).toBe(10);
    const { rows } = await db.query("SELECT delta FROM scan_credit_transactions WHERE kind='purchase'");
    expect(rows).toEqual([{ delta: 5 }]);
  });
  it("credits queued duplicate webhooks exactly once", async () => {
    const id = randomUUID(); await purchase(id);
    const results = await Promise.all(Array.from({ length: 6 }, () => pay(id)));
    expect(results.filter(r => r.status === "credited")).toHaveLength(1);
    expect(await balance()).toBe(10);
  });
  it("supports repeated purchases and rejects a reused event or wrong amount/currency", async () => {
    const first = randomUUID(), second = randomUUID(); await purchase(first); await purchase(second);
    expect((await pay(first, "evt_first")).status).toBe("credited");
    expect((await pay(second, "evt_first")).status).toBe("duplicate");
    expect((await pay(second, "evt_bad", undefined, undefined, 498)).status).toBe("mismatch");
    expect((await pay(second, "evt_bad2", undefined, undefined, 499, "usd")).status).toBe("mismatch");
    expect((await pay(second)).status).toBe("credited");
    expect(await balance()).toBe(15);
  });
  it("rolls back the event, payment and credit when a payment intent is reused", async () => {
    const first = randomUUID(), second = randomUUID(); await purchase(first); await purchase(second);
    await pay(first, "evt_a", undefined, "pi_same");
    await expect(pay(second, "evt_b", undefined, "pi_same")).rejects.toThrow();
    expect(await balance()).toBe(10);
    expect((await db.query("SELECT id FROM stripe_webhook_events WHERE id='evt_b'")).rows).toHaveLength(0);
  });
});

describe("Saving food estimates to the existing diary", () => {
  it("scales portions, marks entries as estimates, and saves the whole meal once", async () => {
    const id = randomUUID(), token = randomUUID(); await begin(id, token); await complete(id, token);
    const result = await save(id);
    const entries = result.entries as { id: string; source: string; grams: number; kcal: number; protein: number }[];
    expect(result.status).toBe("saved");
    expect(entries).toHaveLength(2);
    expect(entries.every(e => e.source === "ai")).toBe(true);
    expect(entries.find(e => e.grams === 100)).toMatchObject({ kcal: 130, protein: 2.7 });
    expect(entries.find(e => e.grams === 200)).toMatchObject({ kcal: 330, protein: 62 });
    expect((await save(id)).entries).toEqual(entries);
    expect(await balance()).toBe(4);
    const replay = await begin(id, token);
    expect(replay.saved).toBe(true);
  });
  it("rejects another user's scan and invalid portions without partially saving", async () => {
    const id = randomUUID(), token = randomUUID(); await begin(id, token); await complete(id, token);
    expect((await save(id, [100, 100], await createTestUser(db))).status).toBe("not_found");
    await expect(save(id, [100, -1])).rejects.toThrow();
    expect((await db.query("SELECT * FROM diary_entries")).rows).toHaveLength(0);
  });
});
