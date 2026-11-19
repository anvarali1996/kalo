import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { AiError } from "@/lib/ai-http";
import { SCAN_PACK, validPaidSession } from "@/lib/stripe";
import { createTestUser, estimate, migrateTestDatabase } from "./database-helpers";

const mocks = vi.hoisted(() => ({ currentUser: vi.fn(), analyze: vi.fn() }));
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let stripe: Stripe;
let userId: string;
let session: Stripe.Checkout.Session;
const webhookSecret = "whsec_local_test_fixture_only";
vi.mock("@/db", () => ({ database: () => db }));
vi.mock("@/lib/server-auth", () => ({ currentUser: mocks.currentUser }));
vi.mock("@/lib/food-vision", () => ({ analyzeFoodPhoto: mocks.analyze }));
vi.mock("@/lib/stripe", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/stripe")>(), stripeClient: () => stripe }));

import { POST as scanPhoto } from "@/app/api/ai/scans/route";
import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { POST as checkout } from "@/app/api/stripe/checkout/route";
import { GET as credits } from "@/app/api/ai/credits/route";
import { GET as adminUsers } from "@/app/api/admin/users/route";
import { GET as getScan } from "@/app/api/ai/scans/[id]/route";
import { POST as saveScan } from "@/app/api/ai/scans/[id]/diary/route";

const balance = async () => (await pg.query<{ credits: number }>("SELECT (kalo_scan_balance($1)->>'credits')::integer AS credits", [userId])).rows[0].credits;
const post = (url: string, body: object, origin = "http://localhost:3000") => new NextRequest(`http://localhost:3000${url}`, {
  method: "POST", headers: { "Content-Type": "application/json", origin }, body: JSON.stringify(body),
});
const image = "data:image/jpeg;base64,/9j/2Q==";
const photoInput = (requestId = randomUUID()) => ({ requestId, locale: "en", image });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
function eventBody(type = "checkout.session.completed", id = "evt_checkout") {
  return JSON.stringify({ id, object: "event", type, data: { object: session } });
}
function signedEvent(body: string, timestamp?: number) {
  const signature = stripe.webhooks.generateTestHeaderString({ payload: body, secret: webhookSecret, timestamp });
  return new Request("http://localhost:3000/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": signature }, body });
}
async function makePurchase() {
  const purchaseId = randomUUID();
  await pg.query("SELECT kalo_start_purchase($1,$2)", [userId, purchaseId]);
  session = {
    id: `cs_${purchaseId}`, object: "checkout.session", mode: "payment", status: "complete", payment_status: "paid",
    amount_total: 499, amount_subtotal: 499, currency: "eur", client_reference_id: userId, payment_intent: `pi_${purchaseId}`,
    metadata: { userId, purchaseId, pack: SCAN_PACK.code },
    line_items: { object: "list", data: [{ quantity: 1, price: { unit_amount: 499, currency: "eur", recurring: null } }], has_more: false, url: "/line_items" },
  } as unknown as Stripe.Checkout.Session;
  vi.mocked(stripe.checkout.sessions.retrieve).mockImplementation(async () => session as Stripe.Response<Stripe.Checkout.Session>);
  return purchaseId;
}

beforeAll(async () => {
  pg = new PGlite(); await migrateTestDatabase(pg); db = drizzle(pg, { schema });
  stripe = new Stripe("sk_test_local_fixture_only");
  vi.spyOn(stripe.checkout.sessions, "retrieve");
  vi.spyOn(stripe.checkout.sessions, "create");
  vi.spyOn(stripe.customers, "create");
  vi.spyOn(stripe.prices, "retrieve");
  vi.spyOn(stripe.refunds, "list").mockReturnValue({ async *[Symbol.asyncIterator]() {} } as unknown as ReturnType<Stripe["refunds"]["list"]>);
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_local_fixture_only");
  vi.stubEnv("STRIPE_PACK20_PRICE_ID", "price_pack20");
  vi.stubEnv("STRIPE_PACK50_PRICE_ID", "price_pack50");
  vi.stubEnv("OPENAI_API_KEY", "local_test_fixture_only");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", webhookSecret);
  vi.stubEnv("APP_URL", "http://localhost:3000");
});
beforeEach(async () => {
  vi.clearAllMocks();
  await pg.exec("TRUNCATE users, stripe_webhook_events CASCADE"); userId = await createTestUser(pg);
  mocks.currentUser.mockResolvedValue({ id: userId, name: "Test User", email: "test@example.test" });
  mocks.analyze.mockResolvedValue(estimate);
});
afterAll(async () => { await pg.close(); vi.unstubAllEnvs(); });

describe("Authenticated scan API", () => {
  it("exposes scanner readiness and the actual credit balance to an authorized admin", async () => {
    vi.stubEnv("KALO_ADMIN_USER_IDS", userId);
    try {
      const response = await adminUsers(new NextRequest("http://localhost:3000/api/admin/users"));
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        scannerSetup: { database: true, openAi: true },
        users: [{ id: userId, scanCredits: 6 }],
      });
    } finally {
      vi.stubEnv("KALO_ADMIN_USER_IDS", "");
    }
  });

  it("requires login before inspecting a photo or calling OpenAI", async () => {
    mocks.currentUser.mockResolvedValue(null);
    expect((await scanPhoto(post("/api/ai/scans", photoInput()))).status).toBe(401);
    expect(mocks.analyze).not.toHaveBeenCalled(); expect(await balance()).toBe(6);
  });
  it("rejects cross-site writes and invalid image bytes without charging", async () => {
    expect((await scanPhoto(post("/api/ai/scans", photoInput(), "https://elsewhere.test"))).status).toBe(403);
    expect((await scanPhoto(post("/api/ai/scans", { ...photoInput(), image: "data:image/jpeg;base64,dGV4dA==" }))).status).toBe(400);
    expect(mocks.analyze).not.toHaveBeenCalled(); expect(await balance()).toBe(6);
  });
  it("returns cached successful results for a repeated request without another model call", async () => {
    const input = photoInput();
    const first = await scanPhoto(post("/api/ai/scans", input));
    expect(first.status).toBe(200); expect((await first.json()).credits).toBe(5);
    const replay = await scanPhoto(post("/api/ai/scans", input));
    expect(replay.status).toBe(200); expect(mocks.analyze).toHaveBeenCalledTimes(1);
    expect(await balance()).toBe(5);
    const recovered = await getScan(new Request("http://localhost:3000"), params(input.requestId));
    expect((await recovered.json()).status).toBe("succeeded");
  });
  it("does not deduct for no-food or provider failures", async () => {
    mocks.analyze.mockRejectedValueOnce(new AiError("aiNoFood", 422));
    expect((await scanPhoto(post("/api/ai/scans", photoInput()))).status).toBe(422);
    mocks.analyze.mockRejectedValueOnce(new AiError("aiScanFailed", 502));
    expect((await scanPhoto(post("/api/ai/scans", photoInput()))).status).toBe(502);
    expect(await balance()).toBe(6);
  });
  it("requires more credits before a seventh successful model call", async () => {
    for (let i = 0; i < 6; i++) expect((await scanPhoto(post("/api/ai/scans", photoInput()))).status).toBe(200);
    expect((await scanPhoto(post("/api/ai/scans", photoInput()))).status).toBe(402);
    expect(mocks.analyze).toHaveBeenCalledTimes(6); expect(await balance()).toBe(0);
  });
  it("saves edited portions to the diary with Zod validation and user isolation", async () => {
    const input = photoInput(); await scanPhoto(post("/api/ai/scans", input));
    const body = { date: "2026-11-18", portions: [100, 200] };
    const saved = await saveScan(post("/api/ai/scans/id/diary", body), params(input.requestId));
    expect(saved.status).toBe(200); expect((await saved.json()).entries).toHaveLength(2);
    const replay = await saveScan(post("/api/ai/scans/id/diary", body), params(input.requestId));
    expect((await replay.json()).entries).toHaveLength(2);
    const invalid = await saveScan(post("/api/ai/scans/id/diary", { ...body, portions: [-1, 200] }), params(input.requestId));
    expect(invalid.status).toBe(400);
    const other = await createTestUser(pg); mocks.currentUser.mockResolvedValue({ id: other });
    expect((await getScan(new Request("http://localhost:3000"), params(input.requestId))).status).toBe(404);
    expect((await saveScan(post("/api/ai/scans/id/diary", body), params(input.requestId))).status).toBe(404);
    expect(await balance()).toBe(5);
  });
});

describe("Stripe Checkout and signed webhook API", () => {
  it("creates a pack checkout with the configured Stripe price and no immediate credit", async () => {
    vi.mocked(stripe.prices.retrieve).mockResolvedValue({ active: true, currency: "eur", type: "one_time",
      unit_amount: 299 } as Stripe.Response<Stripe.Price>);
    vi.mocked(stripe.customers.create).mockResolvedValue({ id: "cus_fixture" } as Stripe.Response<Stripe.Customer>);
    const requestId = randomUUID();
    vi.mocked(stripe.checkout.sessions.create).mockImplementation(async params => ({
      id: "cs_open", status: "open", url: "https://checkout.stripe.com/c/pay/test",
      client_reference_id: userId, customer: params?.customer, metadata: params?.metadata,
    } as Stripe.Response<Stripe.Checkout.Session>));
    const result = await checkout(post("/api/stripe/checkout", { requestId, locale: "lv", product: "pack20" }));
    expect(result.status).toBe(200);
    expect(stripe.checkout.sessions.create).toHaveBeenCalledWith(expect.objectContaining({
      mode: "payment", adaptive_pricing: { enabled: false }, automatic_tax: { enabled: false },
      locale: "lv",
      line_items: [{ price: "price_pack20", quantity: 1 }],
      metadata: { userId, purchaseId: requestId, pack: "pack20" },
      success_url: `http://localhost:3000/?checkout=success&purchase=${requestId}`,
    }), { idempotencyKey: `kalo-pack:${requestId}` });
    expect(await balance()).toBe(6);
    expect((await pg.query("SELECT amount, credits, status FROM scan_purchases")).rows)
      .toEqual([{ amount: 299, credits: 20, status: "pending" }]);
  });

  it("rejects a configured Price with the wrong amount before starting a checkout", async () => {
    vi.mocked(stripe.prices.retrieve).mockResolvedValue({ active: true, currency: "eur", type: "one_time",
      unit_amount: 499 } as Stripe.Response<Stripe.Price>);
    const result = await checkout(post("/api/stripe/checkout", { requestId: randomUUID(), locale: "en", product: "pack50" }));
    expect(result.status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
    expect((await pg.query("SELECT id FROM scan_purchases")).rows).toHaveLength(0);
  });
  it("rejects forged, altered and old webhook signatures", async () => {
    await makePurchase();
    const raw = eventBody();
    const forged = new Request("http://localhost:3000/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": "forged" }, body: raw });
    expect((await webhook(forged)).status).toBe(400);
    const validHeader = stripe.webhooks.generateTestHeaderString({ payload: raw, secret: webhookSecret });
    const altered = new Request("http://localhost:3000/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": validHeader }, body: raw + " " });
    expect((await webhook(altered)).status).toBe(400);
    expect((await webhook(signedEvent(raw, Math.floor(Date.now() / 1000) - 600))).status).toBe(400);
    expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled(); expect(await balance()).toBe(6);
  });
  it("credits a verified paid event once across both repeated and different event IDs", async () => {
    await makePurchase();
    const raw = eventBody();
    expect((await webhook(signedEvent(raw))).status).toBe(200);
    expect((await webhook(signedEvent(raw))).status).toBe(200);
    expect((await webhook(signedEvent(eventBody("checkout.session.async_payment_succeeded", "evt_async")))).status).toBe(200);
    expect(await balance()).toBe(11);
    expect((await pg.query("SELECT * FROM scan_credit_transactions WHERE kind='purchase'")).rows).toHaveLength(1);
  });
  it("waits for delayed payment confirmation and supports another pack", async () => {
    await makePurchase(); session.payment_status = "unpaid";
    expect((await webhook(signedEvent(eventBody()))).status).toBe(200); expect(await balance()).toBe(6);
    session.payment_status = "paid";
    expect((await webhook(signedEvent(eventBody("checkout.session.async_payment_succeeded", "evt_delayed")))).status).toBe(200);
    await makePurchase();
    expect((await webhook(signedEvent(eventBody("checkout.session.completed", "evt_another")))).status).toBe(200);
    expect(await balance()).toBe(16);
  });
  it("records a failed pack payment and accepts a later verified payment without double-granting", async () => {
    const id = await makePurchase();
    session.payment_status = "unpaid";
    expect((await webhook(signedEvent(eventBody("checkout.session.async_payment_failed")))).status).toBe(200);
    expect(await balance()).toBe(6);
    expect((await pg.query("SELECT status FROM scan_purchases WHERE id=$1", [id])).rows).toEqual([{ status: "failed" }]);
    session.payment_status = "paid";
    expect((await webhook(signedEvent(eventBody("checkout.session.async_payment_succeeded", "evt_paid")))).status).toBe(200);
    expect(await balance()).toBe(11);
  });
  it("accepts an exact configured pack Price and rejects a different Price with the same amount", async () => {
    const id = randomUUID();
    await pg.query("UPDATE scan_accounts SET stripe_customer_id='cus_pack_user' WHERE user_id=$1", [userId]);
    await pg.query("SELECT kalo_start_pack($1,$2,'pack20','price_pack20','en')", [userId, id]);
    session = {
      id: "cs_pack20", mode: "payment", status: "complete", payment_status: "paid",
      amount_total: 299, amount_subtotal: 299, currency: "eur", customer: "cus_pack_user",
      client_reference_id: userId, payment_intent: "pi_pack20",
      metadata: { userId, purchaseId: id, pack: "pack20" },
      line_items: { data: [{ quantity: 1, price: { id: "price_wrong", unit_amount: 299, currency: "eur" } }], has_more: false },
    } as unknown as Stripe.Checkout.Session;
    vi.mocked(stripe.checkout.sessions.retrieve).mockImplementation(async () => session as Stripe.Response<Stripe.Checkout.Session>);
    expect((await webhook(signedEvent(eventBody()))).status).toBe(400);
    expect(await balance()).toBe(6);
    session.line_items!.data[0].price!.id = "price_pack20";
    expect((await webhook(signedEvent(eventBody()))).status).toBe(200);
    expect((await webhook(signedEvent(eventBody("checkout.session.completed", "evt_duplicate")))).status).toBe(200);
    expect(await balance()).toBe(26);
  });
  it.each(["amount", "currency", "owner", "mode", "quantity"])("rejects a signed event with the wrong %s", async field => {
    await makePurchase();
    if (field === "amount") session.amount_total = 1;
    if (field === "currency") session.currency = "usd";
    if (field === "owner") session.metadata!.userId = randomUUID();
    if (field === "mode") session.mode = "subscription";
    if (field === "quantity") session.line_items!.data[0].quantity = 2;
    expect((await webhook(signedEvent(eventBody()))).status).toBe(400); expect(await balance()).toBe(6);
  });
  it("never credits a fake browser success return or an unpaid session", async () => {
    await makePurchase();
    const response = await credits(new NextRequest("http://localhost:3000/api/ai/credits?checkout=success"));
    expect((await response.json()).credits).toBe(6);
    session.payment_status = "unpaid";
    await webhook(signedEvent(eventBody())); expect(await balance()).toBe(6);
  });
  it("validates every authoritative payment field before fulfillment", async () => {
    const id = await makePurchase();
    const legacy = { id, userId, checkoutSessionId: session.id, packCode: SCAN_PACK.code, stripePriceId: null,
      amount: SCAN_PACK.amount, currency: SCAN_PACK.currency };
    expect(validPaidSession(session, legacy, null)).toBe(true);
    expect(validPaidSession(session, { ...legacy, checkoutSessionId: "cs_other" }, null)).toBe(false);
  });
});
