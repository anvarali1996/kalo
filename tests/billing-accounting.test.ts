import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { randomUUID } from "node:crypto";
import type { ScanAllowance } from "@/lib/ai-types";
import type { ScanOperation } from "@/lib/scan-accounting";
import { createTestUser, estimate, migrateTestDatabase } from "./database-helpers";

let db: PGlite;
let user: string;
let legacy: Record<string, unknown>;
let legacyPro: Record<string, unknown>;

async function outcome<T>(sql: string, args: unknown[]) {
  return (await db.query<{ value: T }>(sql, args)).rows[0].value;
}
const balance = (id = user) => outcome<ScanAllowance>("SELECT kalo_scan_balance($1) AS value", [id]);
const begin = (id: string, token: string, owner = user) =>
  outcome<ScanOperation>("SELECT kalo_begin_scan($1,$2,$3,$4) AS value", [owner, id, "a".repeat(64), token]);
const complete = (id: string, token: string, owner = user) =>
  outcome<ScanOperation>("SELECT kalo_complete_scan($1,$2,$3,$4) AS value", [owner, id, token, JSON.stringify(estimate)]);
const refund = (intent: string, amount: number, event: string = randomUUID()) =>
  db.query("SELECT kalo_apply_scan_refund($1,$2,$3,'refund.updated')", [intent, amount, event]);

async function scan(owner = user) {
  const id = randomUUID(), token = randomUUID();
  expect((await begin(id, token, owner)).status).toBe("started");
  return complete(id, token, owner);
}

async function makePack(product: "pack20" | "pack50", intent: string = randomUUID()) {
  const id = randomUUID(), amount = product === "pack20" ? 299 : 599;
  await db.query("SELECT kalo_start_pack($1,$2,$3,'price_fixture','en')", [user, id, product]);
  return { id, intent, pay: () => outcome(
    "SELECT kalo_credit_purchase($1,$2,$3,$4,$5,'checkout.session.completed',$6,'eur') AS value",
    [user, id, "cs_" + id, intent, randomUUID(), amount],
  ) };
}

async function makeSubscription(id = "sub_fixture", owner = user) {
  const checkoutId = randomUUID();
  const customer = `cus_${id}`;
  await db.query("UPDATE scan_accounts SET stripe_customer_id=$1 WHERE user_id=$2", [customer, owner]);
  await db.query("SELECT kalo_reserve_pro_checkout($1,$2,'price_fixture','en')", [owner, checkoutId]);
  await db.query("SELECT kalo_sync_pro_subscription($1,$2,$3,$4,'active',now(),now()+interval '1 month',NULL,now())", [owner, checkoutId, customer, id]);
  return id;
}

const pro = (subscription: string, intent: string, invoice = "in_one") => outcome<string>(
  `SELECT kalo_record_pro_invoice($1,$2,$3,$4,'invoice.paid',date_trunc('minute',now()),
    now()+interval '1 month',now(),now(),799,120) AS value`,
  [invoice, subscription, intent, randomUUID()],
);

beforeAll(async () => {
  db = new PGlite();
  await migrateTestDatabase(db, 0, 2);
  const existing = await createTestUser(db);
  const purchase = randomUUID();
  await db.query("SELECT kalo_start_purchase($1,$2)", [existing, purchase]);
  await db.query("SELECT kalo_credit_purchase($1,$2,'cs_legacy','pi_legacy','evt_legacy','checkout.session.completed',499,'eur')", [existing, purchase]);
  for (let i = 0; i < 7; i++) await scan(existing);
  await db.query("INSERT INTO diary_entries (user_id,date,name,grams,kcal,source) VALUES ($1,'2026-11-18','Existing meal',100,200,'manual')", [existing]);
  await db.query("INSERT INTO sessions(user_id,token_hash,expires_at) VALUES ($1,$2,now()+interval '1 day')", [existing, "c".repeat(64)]);
  await migrateTestDatabase(db, 2, 3);
  const subscriber = await createTestUser(db);
  const legacySubscription = await makeSubscription("sub_legacy_pro", subscriber);
  await db.query(`SELECT kalo_record_pro_invoice('in_legacy',$1,'pi_legacy_pro','evt_legacy_pro','invoice.paid',
    now()-interval '1 day',now()+interval '1 month',now(),now())`, [legacySubscription]);
  await scan(subscriber);
  await refund("pi_legacy_pro", 500);
  const priorProBalance = await balance(subscriber);
  await migrateTestDatabase(db, 3);
  legacyPro = {
    priorProBalance,
    balance: await balance(subscriber),
    invoice: (await db.query("SELECT amount, credits, used, refunded_amount FROM pro_invoices WHERE id='in_legacy'")).rows[0],
  };
  legacy = {
    allowance: await balance(existing),
    purchase: (await db.query("SELECT status, remaining_credits FROM scan_purchases WHERE id=$1", [purchase])).rows[0],
    diary: (await db.query("SELECT name FROM diary_entries WHERE user_id=$1", [existing])).rows,
    sessions: (await db.query("SELECT user_id FROM sessions WHERE user_id=$1", [existing])).rows.length,
  };
});

beforeEach(async () => {
  await db.exec("TRUNCATE users, stripe_webhook_events, stripe_scan_refunds CASCADE");
  user = await createTestUser(db);
});
afterAll(async () => { await db.close(); });

it("preserves the exact unused legacy balance, paid purchase, diary and sessions", () => {
  expect(legacy).toMatchObject({
    allowance: { plan: "basic", purchasedCredits: 3, monthlyCredits: 6, credits: 9 },
    purchase: { status: "paid", remaining_credits: 3 }, diary: [{ name: "Existing meal" }], sessions: 1,
  });
});

it("preserves the original Pro allowance, usage and partial refund on migration", () => {
  expect(legacyPro).toMatchObject({
    balance: { plan: "pro", monthlyCredits: 49 },
    invoice: { amount: 999, credits: 100, used: 1, refunded_amount: 500 },
  });
  expect(legacyPro.balance).toEqual(legacyPro.priorProBalance);
});

it("uses a fresh six-scan UTC month regardless of database time zone or previous usage", async () => {
  try {
    await db.exec("SET TIME ZONE 'Pacific/Kiritimati'");
    await db.query(`INSERT INTO basic_scan_months(user_id,month_start,used)
      VALUES ($1,(date_trunc('month',now() AT TIME ZONE 'UTC')-interval '1 month')::date,6)`, [user]);
    const now = new Date();
    const nextUtcMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    expect(new Date((await balance()).monthlyExpiresAt)).toEqual(nextUtcMonth);
    for (let i = 0; i < 6; i++) await scan();
    expect((await begin(randomUUID(), randomUUID())).status).toBe("no_credits");
    expect(await balance()).toMatchObject({ monthlyCredits: 0, purchasedCredits: 0 });
  } finally { await db.exec("RESET TIME ZONE"); }
});

it("spends monthly credits before FIFO packs and revokes only the refunded pack's unspent credits", async () => {
  const small = await makePack("pack20", "pi_small");
  await small.pay();
  const large = await makePack("pack50", "pi_large");
  await large.pay();
  for (let i = 0; i < 6; i++) await scan();
  expect(await balance()).toMatchObject({ monthlyCredits: 0, purchasedCredits: 70 });
  for (let i = 0; i < 4; i++) await scan();
  await refund(small.intent, 150, "evt_partial");
  await refund(small.intent, 150, "evt_partial");
  expect(await balance()).toMatchObject({ purchasedCredits: 56 });
  await refund(small.intent, 299);
  await refund(small.intent, 150);
  expect(await balance()).toMatchObject({ purchasedCredits: 50 });
  expect((await db.query("SELECT status, remaining_credits FROM scan_purchases WHERE id=$1", [small.id])).rows[0])
    .toEqual({ status: "refunded", remaining_credits: 0 });
});

it("handles refunds racing payment and keeps budget mutations idempotent", async () => {
  const pack = await makePack("pack20", "pi_early");
  await refund(pack.intent, 299);
  await Promise.all([pack.pay(), pack.pay(), refund(pack.intent, 299)]);
  expect(await balance()).toMatchObject({ monthlyCredits: 6, purchasedCredits: 0 });
  const id = randomUUID(), token = randomUUID();
  expect((await begin(id, token)).status).toBe("started");
  const results = await Promise.all([complete(id, token), complete(id, token), complete(id, token)]);
  expect(results.map(r => r.credits)).toEqual([5, 5, 5]);
  expect((await db.query("SELECT id FROM scan_credit_transactions WHERE kind='scan'")).rows).toHaveLength(1);
});

it("allows all 120 scans in a paid cycle and restores prior Basic usage when the cycle ends", async () => {
  await scan();
  const subscription = await makeSubscription();
  expect(await pro(subscription, "pi_pro")).toBe("recorded");
  expect(await pro(subscription, "pi_pro")).toBe("duplicate");
  expect(await pro(subscription, "pi_duplicate_cycle", "in_other")).toBe("duplicate");
  expect(await balance()).toMatchObject({ plan: "pro", monthlyCredits: 120 });
  for (let i = 0; i < 120; i++) await scan();
  expect((await begin(randomUUID(), randomUUID())).status).toBe("no_credits");
  await db.exec("UPDATE pro_invoices SET period_start=now()-interval '1 month',period_end=now()-interval '1 second'");
  expect(await balance()).toMatchObject({ plan: "basic", monthlyCredits: 5 });
});

it("removes unspent Pro entitlement after refunds without touching purchased scans", async () => {
  const pack = await makePack("pack20");
  await pack.pay();
  const subscription = await makeSubscription();
  await pro(subscription, "pi_pro");
  await scan();
  await refund("pi_pro", 500);
  expect(await balance()).toMatchObject({ plan: "pro", monthlyCredits: 44, purchasedCredits: 20 });
  await refund("pi_pro", 799);
  expect(await balance()).toMatchObject({ plan: "basic", monthlyCredits: 6, purchasedCredits: 20 });
});

it("records a refund of the full 120-scan allowance only once", async () => {
  await pro(await makeSubscription(), "pi_pro");
  await Promise.all([refund("pi_pro", 799), refund("pi_pro", 799)]);
  expect(await balance()).toMatchObject({ plan: "basic", monthlyCredits: 6 });
  expect((await db.query("SELECT delta FROM scan_credit_transactions WHERE kind='refund'")).rows).toEqual([{ delta: -120 }]);
});
