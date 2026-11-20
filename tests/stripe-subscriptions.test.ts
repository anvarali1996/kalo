import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { NextRequest } from "next/server";
import * as schema from "@/db/schema";
import { createTestUser, migrateTestDatabase } from "./database-helpers";

const viewer = vi.hoisted(() => vi.fn());
let pg: PGlite;
let db: ReturnType<typeof drizzle<typeof schema>>;
let stripe: Stripe;
let userId: string;
let checkoutId: string;
let subscription: Stripe.Subscription;
let invoice: Stripe.Invoice;
let intent: Stripe.PaymentIntent;
let refunds: Stripe.Refund[];
let remoteSession: Stripe.Response<Stripe.Checkout.Session>;
let paidPayments: Stripe.InvoicePayment[];
const customer = "cus_test_owner";
const secret = "whsec_test_fixture_only";
const price = "price_pro_fixture";
const legacyPrice = "price_pro_legacy";
const now = () => Math.floor(Date.now() / 1000);
const day = 86400;

vi.mock("@/db", () => ({ database: () => db }));
vi.mock("@/lib/server-auth", () => ({ currentUser: viewer }));
vi.mock("@/lib/stripe", async original => ({ ...await original<typeof import("@/lib/stripe")>(), stripeClient: () => stripe }));

import { POST as webhook } from "@/app/api/stripe/webhook/route";
import { POST as checkout } from "@/app/api/stripe/checkout/route";
import { POST as portal } from "@/app/api/stripe/portal/route";
import { GET as credits } from "@/app/api/ai/credits/route";

const request = (route: string, data: object) => new NextRequest(`http://localhost:3000/api/stripe/${route}`, {
  method: "POST", headers: { origin: "http://localhost:3000", "Content-Type": "application/json" }, body: JSON.stringify(data),
});
const send = (type: string, object: object, id: string = randomUUID(), created = now()) => {
  const payload = JSON.stringify({ id, type, created, data: { object } });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret });
  return webhook(new Request("http://localhost:3000/api/stripe/webhook", {
    method: "POST", headers: { "stripe-signature": signature }, body: payload,
  }));
};
const account = async () => {
  const res = await credits(new NextRequest("http://localhost:3000/api/ai/credits"));
  expect(res.status).toBe(200);
  return res.json();
};

async function reserve(priceId = price) {
  await pg.query("SELECT kalo_reserve_pro_checkout($1,$2,$3,'en')", [userId, checkoutId, priceId]);
}

async function reserveNearExpiry() {
  await reserve();
  const expiresAt = now() + 15 * 60;
  await pg.query(`UPDATE pro_checkouts SET expires_at=to_timestamp($1),
    created_at=to_timestamp($1)-interval '1 hour' WHERE id=$2`, [expiresAt, checkoutId]);
  return expiresAt;
}

const checkoutRow = async (id = checkoutId) =>
  (await pg.query("SELECT status, checkout_session_id FROM pro_checkouts WHERE id=$1", [id])).rows[0];

const invalidExpiry = () => new Stripe.errors.StripeInvalidRequestError({
  type: "invalid_request_error", statusCode: 400, param: "expires_at",
  message: "The requested expiry is less than 30 minutes after creation.",
});

function cycle(id: string, start: number, end: number, paid: boolean, priceId = price, amount = 799) {
  const billingReason = id === "in_first" ? "subscription_create" : "subscription_cycle";
  subscription.items.data[0].current_period_end = end;
  invoice = {
    id, customer, billing_reason: billingReason, status: paid ? "paid" : "open", currency: "eur", total: amount,
    amount_paid: paid ? amount : 0, amount_remaining: paid ? 0 : amount, created: start,
    status_transitions: { paid_at: paid ? now() : null },
    parent: { subscription_details: { subscription: subscription.id } },
    lines: { has_more: false, data: [{ quantity: 1, amount, period: { start, end },
      pricing: { price_details: { price: priceId } }, parent: { subscription_item_details: { proration: false } } }] },
  } as unknown as Stripe.Invoice;
  intent = { id: `pi_${id}`, customer, status: "succeeded", currency: "eur", amount_received: amount } as Stripe.PaymentIntent;
  paidPayments = paid ? [{
    invoice: id, status: "paid", amount_paid: amount, currency: "eur", payment: { type: "payment_intent", payment_intent: intent },
  } as Stripe.InvoicePayment] : [];
}

beforeAll(async () => {
  pg = new PGlite();
  await migrateTestDatabase(pg);
  db = drizzle(pg, { schema });
  stripe = new Stripe("sk_test_fixture_only");
  vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_fixture_only");
  vi.stubEnv("STRIPE_WEBHOOK_SECRET", secret);
  vi.stubEnv("STRIPE_PRO_PRICE_ID", price);
  vi.stubEnv("APP_URL", "http://localhost:3000");
  vi.spyOn(stripe.prices, "retrieve").mockImplementation(async id => ({
    id, active: true, type: "recurring", currency: "eur", unit_amount: id === legacyPrice ? 999 : 799,
    recurring: { interval: "month", interval_count: 1, usage_type: "licensed" },
  }) as Stripe.Response<Stripe.Price>);
  vi.spyOn(stripe.subscriptions, "list").mockReturnValue(
    { async *[Symbol.asyncIterator]() {} } as unknown as ReturnType<Stripe["subscriptions"]["list"]>,
  );
  vi.spyOn(stripe.subscriptions, "retrieve").mockImplementation(async () => subscription as Stripe.Response<Stripe.Subscription>);
  vi.spyOn(stripe.invoices, "retrieve").mockImplementation(async () => invoice as Stripe.Response<Stripe.Invoice>);
  vi.spyOn(stripe.invoicePayments, "list").mockImplementation(() =>
    Promise.resolve({ data: paidPayments, has_more: false }) as unknown as ReturnType<Stripe["invoicePayments"]["list"]>);
  vi.spyOn(stripe.paymentIntents, "retrieve").mockImplementation(async () => intent as Stripe.Response<Stripe.PaymentIntent>);
  vi.spyOn(stripe.refunds, "list").mockImplementation(() => ({
    async *[Symbol.asyncIterator]() { yield* refunds; },
  }) as unknown as ReturnType<Stripe["refunds"]["list"]>);
  vi.spyOn(stripe.billingPortal.sessions, "create").mockResolvedValue({
    url: "https://billing.stripe.com/mock_portal",
  } as Stripe.Response<Stripe.BillingPortal.Session>);
  vi.spyOn(stripe.checkout.sessions, "create").mockImplementation(async params => {
    remoteSession = {
      id: "cs_pro", status: "open", mode: "subscription", url: "https://checkout.stripe.com/mock_checkout",
      customer, client_reference_id: userId, metadata: params?.metadata ?? null,
    } as Stripe.Response<Stripe.Checkout.Session>;
    return remoteSession;
  });
  vi.spyOn(stripe.checkout.sessions, "retrieve").mockImplementation(async () => remoteSession);
});
beforeEach(async () => {
  vi.clearAllMocks();
  await pg.exec("TRUNCATE users, stripe_webhook_events, stripe_scan_refunds CASCADE");
  userId = await createTestUser(pg);
  checkoutId = randomUUID();
  await pg.query("UPDATE scan_accounts SET stripe_customer_id=$1 WHERE user_id=$2", [customer, userId]);
  viewer.mockResolvedValue({ id: userId, email: "stripe-owner@example.test", name: "Stripe owner" });
  subscription = {
    id: "sub_test_pro", created: now() - day, status: "active", customer,
    metadata: { kaloProCheckout: checkoutId, userId },
    items: { data: [{ price: { id: price }, current_period_end: now() + day * 28 }] },
    cancel_at: null, cancel_at_period_end: false,
  } as unknown as Stripe.Subscription;
  refunds = [];
  cycle("in_first", now() - day, now() + day * 28, true);
});
afterAll(async () => { await pg.close(); vi.unstubAllEnvs(); });

it("resumes the same Pro Checkout and gives no credits for a Checkout completion alone", async () => {
  const first = await checkout(request("checkout", { product: "pro", requestId: checkoutId, locale: "en" }));
  const second = await checkout(request("checkout", { product: "pro", requestId: randomUUID(), locale: "ru" }));
  expect(first.status).toBe(200);
  expect(await second.json()).toEqual(await first.json());
  expect(stripe.checkout.sessions.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    mode: "subscription", line_items: [{ price, quantity: 1 }], customer,
    subscription_data: { metadata: { kaloProCheckout: checkoutId, userId } },
  }), { idempotencyKey: `kalo-pro:${checkoutId}` });
  expect((await send("checkout.session.completed", { ...remoteSession, status: "complete", subscription: subscription.id })).status).toBe(200);
  expect(await account()).toMatchObject({ plan: "basic", credits: 6, canSubscribe: false });
  expect((await checkout(request("checkout", { product: "pro", requestId: randomUUID(), locale: "en" }))).status).toBe(409);
});

it("rejects the old monthly price as configuration for new Checkouts", async () => {
  vi.stubEnv("STRIPE_PRO_PRICE_ID", legacyPrice);
  try {
    expect((await checkout(request("checkout", { product: "pro", requestId: checkoutId, locale: "en" }))).status).toBe(503);
    expect(stripe.checkout.sessions.create).not.toHaveBeenCalled();
  } finally { vi.stubEnv("STRIPE_PRO_PRICE_ID", price); }
});

it("leaves a pending old-price Checkout in place until expiry without reopening it", async () => {
  await reserve(legacyPrice);
  await pg.query("UPDATE pro_checkouts SET checkout_session_id='cs_old' WHERE id=$1", [checkoutId]);
  const newCheckout = { product: "pro", requestId: randomUUID(), locale: "en" };
  expect((await checkout(request("checkout", newCheckout))).status).toBe(409);
  expect(stripe.checkout.sessions.retrieve).not.toHaveBeenCalled();
  expect((await send("checkout.session.expired", {
    id: "cs_old", customer, client_reference_id: userId, metadata: { kaloProCheckout: checkoutId, userId },
  })).status).toBe(200);
  expect((await checkout(request("checkout", newCheckout))).status).toBe(200);
});

it("releases only the rejected Pro reservation when Stripe confirms its expiry is too close", async () => {
  const expiresAt = await reserveNearExpiry();
  const otherUser = await createTestUser(pg);
  const otherCheckout = randomUUID();
  await pg.query("SELECT kalo_reserve_pro_checkout($1,$2,$3,'en')", [otherUser, otherCheckout, price]);
  const createSession = vi.mocked(stripe.checkout.sessions.create).mockRejectedValueOnce(invalidExpiry());

  const rejected = await checkout(request("checkout", { product: "pro", locale: "ru", requestId: randomUUID() }));
  expect(rejected.status).toBe(409);
  expect(await rejected.json()).toEqual({ error: "aiCheckoutFinished" });
  expect(createSession).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    expires_at: expiresAt, locale: "en",
  }), { idempotencyKey: `kalo-pro:${checkoutId}` });
  expect(await checkoutRow()).toEqual({ status: "expired", checkout_session_id: null });
  expect(await checkoutRow(otherCheckout)).toEqual({ status: "pending", checkout_session_id: null });

  const freshId = randomUUID();
  const fresh = await checkout(request("checkout", { product: "pro", locale: "ru", requestId: freshId }));
  expect(fresh.status).toBe(200);
  expect(createSession).toHaveBeenNthCalledWith(2, expect.objectContaining({
    metadata: { kaloProCheckout: freshId, userId }, locale: "ru",
  }), { idempotencyKey: `kalo-pro:${freshId}` });
  expect(await checkoutRow(freshId)).toEqual({ status: "pending", checkout_session_id: "cs_pro" });
  expect(await account()).toMatchObject({ plan: "basic", credits: 6, purchases: [] });
});

it("keeps the Pro reservation after an ambiguous Stripe failure and replays with the same key and parameters", async () => {
  const expiresAt = await reserveNearExpiry();
  const createSession = vi.mocked(stripe.checkout.sessions.create).mockRejectedValueOnce(
    new Stripe.errors.StripeConnectionError({ message: "Checkout response was lost." }),
  );
  const failed = await checkout(request("checkout", { product: "pro", locale: "en", requestId: checkoutId }));
  expect(failed.status).toBe(503);
  expect(await checkoutRow()).toEqual({ status: "pending", checkout_session_id: null });

  const replay = await checkout(request("checkout", { product: "pro", locale: "lv", requestId: randomUUID() }));
  expect(replay.status).toBe(200);
  expect(await replay.json()).toEqual({ url: "https://checkout.stripe.com/mock_checkout" });
  expect(createSession).toHaveBeenCalledTimes(2);
  expect(createSession.mock.calls[0]).toEqual([
    expect.objectContaining({ expires_at: expiresAt, locale: "en" }), { idempotencyKey: `kalo-pro:${checkoutId}` },
  ]);
  expect(createSession.mock.calls[1]).toEqual(createSession.mock.calls[0]);
  expect(await checkoutRow()).toEqual({ status: "pending", checkout_session_id: "cs_pro" });
});

it("keeps a fresh Pro reservation after an unexpected Stripe expiry validation error", async () => {
  await reserve();
  vi.mocked(stripe.checkout.sessions.create).mockRejectedValueOnce(invalidExpiry());
  const result = await checkout(request("checkout", { product: "pro", locale: "en", requestId: checkoutId }));
  expect(result.status).toBe(503);
  expect(await checkoutRow()).toEqual({ status: "pending", checkout_session_id: null });
});

it("preserves a Pro Session attached while the expiry rejection was in flight", async () => {
  await reserveNearExpiry();
  vi.mocked(stripe.checkout.sessions.create).mockImplementationOnce(async () => {
    await pg.query("UPDATE pro_checkouts SET checkout_session_id='cs_attached' WHERE id=$1", [checkoutId]);
    throw invalidExpiry();
  });

  await checkout(request("checkout", { product: "pro", locale: "en", requestId: checkoutId }));
  expect(await checkoutRow()).toEqual({ status: "pending", checkout_session_id: "cs_attached" });
});

it("verifies the card payment, grants each paid cycle once and reports scheduled cancellation", async () => {
  await reserve();
  expect((await send("invoice.paid", invoice, "evt_first")).status).toBe(200);
  expect((await send("invoice.paid", invoice, "evt_first")).status).toBe(200);
  expect((await send("invoice.paid", invoice, "evt_second_delivery")).status).toBe(200);
  expect(await account()).toMatchObject({ plan: "pro", monthlyCredits: 120, purchasedCredits: 0,
    proCheckoutId: checkoutId, renewalAt: expect.any(String), purchases: [{ id: "in_first", status: "paid", amount: 799, credits: 120 }] });
  expect((await pg.query("SELECT delta FROM scan_credit_transactions WHERE kind='pro'")).rows).toEqual([{ delta: 120 }]);
  subscription.cancel_at_period_end = true;
  expect((await send("customer.subscription.updated", subscription)).status).toBe(200);
  expect(await account()).toMatchObject({ plan: "pro", monthlyCredits: 120, renewalAt: null, cancelAt: expect.any(String) });
});

it("falls back to Basic after a failed renewal and grants the next cycle only when Stripe collects payment", async () => {
  await reserve();
  const boundary = now() - 10;
  cycle("in_first", boundary - 29 * day, boundary, true);
  await send("invoice.paid", invoice);
  cycle("in_renewal", boundary, boundary + 30 * day, false);
  subscription.status = "past_due";
  expect((await send("invoice.payment_failed", invoice)).status).toBe(200);
  expect(await account()).toMatchObject({ plan: "basic", monthlyCredits: 6, subscriptionStatus: "past_due",
    purchases: [expect.objectContaining({ id: "in_renewal", status: "failed" }), expect.anything()] });

  cycle("in_renewal", boundary, boundary + 30 * day, true);
  subscription.status = "active";
  expect((await send("invoice.paid", invoice)).status).toBe(200);
  expect(await account()).toMatchObject({ plan: "pro", monthlyCredits: 120,
    purchases: [expect.objectContaining({ id: "in_renewal", status: "paid" }), expect.anything()] });

  subscription.status = "canceled";
  expect((await send("customer.subscription.deleted", subscription, "evt_cancel", now() + 1)).status).toBe(200);
  expect((await send("customer.subscription.updated", { ...subscription, status: "active" }, "evt_late", now() - 1)).status).toBe(200);
  expect(await account()).toMatchObject({ plan: "pro", subscriptionStatus: "canceled", renewalAt: null });
});

it("preserves original-price renewals and grants 120 on the first paid renewal after a price change", async () => {
  await reserve(legacyPrice);
  subscription.items.data[0].price.id = legacyPrice;
  const boundary = now() - 10;
  cycle("in_original_renewal", boundary - 30 * day, boundary, true, legacyPrice, 999);
  expect((await send("invoice.paid", invoice)).status).toBe(200);
  expect(await account()).toMatchObject({ purchases: [{ status: "paid", amount: 999, credits: 100 }] });

  subscription.items.data[0].price.id = price;
  cycle("in_new_renewal", boundary, boundary + 30 * day, true);
  expect((await send("invoice.paid", invoice)).status).toBe(200);
  const renewed = await account();
  expect(renewed).toMatchObject({ plan: "pro", monthlyCredits: 120,
    purchases: [{ id: "in_new_renewal", amount: 799, credits: 120 }, { id: "in_original_renewal", amount: 999, credits: 100 }] });
  expect(new Date(renewed.renewalAt).getTime()).toBe((boundary + 30 * day) * 1000);
});

it("rejects currency, price, customer and out-of-band paid invoices", async () => {
  await reserve();
  cycle("in_first", now() - day, now() + 28 * day, true, price, 999);
  expect((await send("invoice.paid", invoice)).status).toBe(400);
  cycle("in_first", now() - day, now() + 28 * day, true);
  invoice.currency = "usd";
  expect((await send("invoice.paid", invoice)).status).toBe(400);
  invoice.currency = "eur";
  invoice.lines.data[0].pricing!.price_details!.price = "price_wrong";
  expect((await send("invoice.paid", invoice)).status).toBe(400);
  invoice.lines.data[0].pricing!.price_details!.price = price;
  invoice.customer = "cus_other";
  expect((await send("invoice.paid", invoice)).status).toBe(400);
  invoice.customer = customer;
  paidPayments = [];
  expect((await send("invoice.paid", invoice)).status).toBe(400);
  expect(await account()).toMatchObject({ plan: "basic", credits: 6, purchases: [] });
});

it("reconciles a verified refund delivered ahead of a paid invoice and exposes refund history", async () => {
  await reserve();
  refunds = [{ amount: 799, currency: "eur", status: "succeeded", payment_intent: intent.id } as Stripe.Refund];
  expect((await send("refund.updated", refunds[0], "evt_early_refund")).status).toBe(200);
  expect((await send("invoice.paid", invoice, "evt_paid_later")).status).toBe(200);
  expect((await send("refund.updated", refunds[0], "evt_early_refund")).status).toBe(200);
  expect(await account()).toMatchObject({ plan: "basic", credits: 6, purchases: [{ id: invoice.id, status: "refunded", refundedAmount: 799 }] });
});

it("opens the Stripe customer portal only for the authenticated account's stored customer", async () => {
  expect((await portal(request("portal", { locale: "en", customer: "cus_other" }))).status).toBe(400);
  expect((await portal(request("portal", { locale: "ru" }))).status).toBe(200);
  expect(stripe.billingPortal.sessions.create).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
    customer, locale: "ru", return_url: "http://localhost:3000/?billing=1",
  }));
  viewer.mockResolvedValue(null);
  expect((await portal(request("portal", { locale: "en" }))).status).toBe(401);
});
