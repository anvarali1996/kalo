import type Stripe from "stripe";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { database } from "@/db";
import { proCheckouts, scanAccounts, scanPurchases, stripeWebhookEvents } from "@/db/schema";
import { AiError } from "./ai-http";
import { requestIdSchema } from "./ai-validation";
import { legacyProPricing, pricing } from "./pricing";
import { applyRefund, creditPurchase, recordProInvoice, syncProSubscription } from "./scan-accounting";
import { matchesPackSession, matchesProPrice, SCAN_PACK, stripeId, stripePriceId, validPaidSession } from "./stripe";

const iso = (seconds: number) => new Date(seconds * 1000).toISOString();
const verifiedPaymentError = () => new AiError("payment_mismatch", 400);

async function subscriptionFromStripe(subscription: Stripe.Subscription, event: Stripe.Event) {
  const metadata = subscription.metadata;
  if (!metadata?.kaloProCheckout) return null;
  const checkoutId = requestIdSchema.safeParse(metadata.kaloProCheckout);
  if (!checkoutId.success) throw verifiedPaymentError();

  const [checkout] = await database().select({
    userId: proCheckouts.userId, priceId: proCheckouts.stripePriceId, customerId: scanAccounts.stripeCustomerId,
  }).from(proCheckouts).innerJoin(scanAccounts, eq(proCheckouts.userId, scanAccounts.userId))
    .where(eq(proCheckouts.id, checkoutId.data)).limit(1);
  if (!checkout || checkout.userId !== metadata.userId || !checkout.customerId ||
      stripeId(subscription.customer) !== checkout.customerId) throw verifiedPaymentError();

  const currentPriceId = stripePriceId("pro");
  const periodEnd = subscription.items.data.find(item => item.price.id === checkout.priceId ||
    item.price.id === currentPriceId)?.current_period_end;
  const cancel = subscription.status === "canceled" ? null
    : subscription.cancel_at ?? (subscription.cancel_at_period_end ? periodEnd ?? null : null);
  const synced = await syncProSubscription({
    userId: checkout.userId, checkoutId: checkoutId.data, customerId: checkout.customerId,
    subscriptionId: subscription.id, status: subscription.status, createdAt: iso(subscription.created),
    periodEnd: periodEnd ? iso(periodEnd) : null, cancelAt: cancel ? iso(cancel) : null, eventAt: iso(event.created),
  });
  if (!synced) throw verifiedPaymentError();
  return checkout;
}

async function successfulRefundAmount(stripe: Stripe, paymentIntent: string) {
  let amount = 0;
  for await (const refund of stripe.refunds.list({ payment_intent: paymentIntent, limit: 100 })) {
    if (refund.status === "succeeded" && refund.currency === "eur" &&
        stripeId(refund.payment_intent) === paymentIntent) amount += refund.amount;
  }
  return amount;
}

async function handleCheckout(stripe: Stripe, event: Stripe.Event) {
  const snapshot = event.data.object as Stripe.Checkout.Session;
  const db = database();
  if (snapshot.metadata?.kaloProCheckout) {
    const id = requestIdSchema.parse(snapshot.metadata.kaloProCheckout);
    const [checkout] = await db.select({
      userId: proCheckouts.userId, sessionId: proCheckouts.checkoutSessionId, customerId: scanAccounts.stripeCustomerId,
    }).from(proCheckouts).innerJoin(scanAccounts, eq(proCheckouts.userId, scanAccounts.userId))
      .where(eq(proCheckouts.id, id)).limit(1);
    if (!checkout || checkout.userId !== snapshot.client_reference_id || checkout.userId !== snapshot.metadata.userId ||
        !checkout.customerId || checkout.customerId !== stripeId(snapshot.customer) ||
        (checkout.sessionId && checkout.sessionId !== snapshot.id)) throw verifiedPaymentError();

    if (event.type === "checkout.session.expired") {
      await db.update(proCheckouts).set({ status: "expired", checkoutSessionId: snapshot.id })
        .where(and(eq(proCheckouts.id, id), eq(proCheckouts.status, "pending")));
      return;
    }
    const subscriptionId = stripeId(snapshot.subscription);
    if (subscriptionId) await subscriptionFromStripe(await stripe.subscriptions.retrieve(subscriptionId), event);
    return;
  }

  const code = snapshot.metadata?.pack;
  if (code !== SCAN_PACK.code && code !== "pack20" && code !== "pack50") return;
  const id = requestIdSchema.parse(snapshot.metadata?.purchaseId);
  const [record] = await db.select({ purchase: scanPurchases, customerId: scanAccounts.stripeCustomerId })
    .from(scanPurchases).innerJoin(scanAccounts, eq(scanPurchases.userId, scanAccounts.userId))
    .where(eq(scanPurchases.id, id)).limit(1);
  if (!record || !matchesPackSession(snapshot, record.purchase, record.customerId)) throw verifiedPaymentError();

  const session = await stripe.checkout.sessions.retrieve(snapshot.id, { expand: ["line_items"] });
  if (!matchesPackSession(session, record.purchase, record.customerId)) throw verifiedPaymentError();
  if (session.payment_status === "paid") {
    if (!validPaidSession(session, record.purchase, record.customerId)) throw verifiedPaymentError();
    const intent = stripeId(session.payment_intent)!;
    await applyRefund(intent, await successfulRefundAmount(stripe, intent));
    const result = await creditPurchase({ userId: record.purchase.userId, purchaseId: id, sessionId: session.id,
      paymentIntentId: intent, eventId: event.id, eventType: event.type, amount: session.amount_total!, currency: session.currency! });
    if (result.status === "mismatch") throw verifiedPaymentError();
    return;
  }
  const failed = event.type === "checkout.session.async_payment_failed";
  if (!failed && session.status !== "expired") return;
  await db.update(scanPurchases).set({ status: failed ? "failed" : "expired", checkoutSessionId: session.id })
    .where(and(eq(scanPurchases.id, id), inArray(scanPurchases.status, ["pending", "failed", "expired"]),
      or(isNull(scanPurchases.checkoutSessionId), eq(scanPurchases.checkoutSessionId, session.id))));
  await db.insert(stripeWebhookEvents).values({ id: event.id, type: event.type }).onConflictDoNothing();
}

async function proPaymentIntent(stripe: Stripe, invoice: Stripe.Invoice, customerId: string, amount: number) {
  if (invoice.amount_paid !== amount || invoice.amount_remaining !== 0) throw verifiedPaymentError();
  // Invoice status can also become paid when marked paid outside Stripe.
  const payments = await stripe.invoicePayments.list({
    invoice: invoice.id, status: "paid", limit: 2, expand: ["data.payment.payment_intent"],
  });
  const payment = payments.data[0];
  const resource = payment?.payment.payment_intent;
  if (payments.has_more || payments.data.length !== 1 || payment.status !== "paid" ||
      payment.amount_paid !== amount || payment.currency !== "eur" || stripeId(payment.invoice) !== invoice.id ||
      payment.payment.type !== "payment_intent" || !resource) throw verifiedPaymentError();
  const intent = typeof resource === "string" ? await stripe.paymentIntents.retrieve(resource) : resource;
  if (intent.status !== "succeeded" || intent.currency !== "eur" ||
      intent.amount_received !== amount || stripeId(intent.customer) !== customerId) throw verifiedPaymentError();
  return intent.id;
}

async function handleInvoice(stripe: Stripe, event: Stripe.Event) {
  const snapshot = event.data.object as Stripe.Invoice;
  const invoice = await stripe.invoices.retrieve(snapshot.id);
  const subscriptionId = stripeId(invoice.parent?.subscription_details?.subscription);
  if (!subscriptionId) return;
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  const checkout = await subscriptionFromStripe(subscription, event);
  if (!checkout) return;
  if (invoice.billing_reason !== "subscription_create" && invoice.billing_reason !== "subscription_cycle") return;

  const line = invoice.lines.data[0];
  const item = line?.parent?.subscription_item_details;
  const priceId = stripeId(line?.pricing?.price_details?.price);
  const originalPrice = priceId === checkout.priceId;
  const newRenewalPrice = invoice.billing_reason === "subscription_cycle" && priceId === stripePriceId("pro");
  if (!checkout.customerId || stripeId(invoice.customer) !== checkout.customerId ||
      invoice.lines.has_more || invoice.lines.data.length !== 1 || line.quantity !== 1 || !item || item.proration ||
      !priceId || (!originalPrice && !newRenewalPrice) || invoice.currency !== "eur" ||
      line.period.end <= line.period.start) throw verifiedPaymentError();

  const paid = invoice.status === "paid";
  if (!paid && event.type !== "invoice.payment_failed") return;
  // Stripe keeps archived Prices available for older invoices and renewals.
  const price = await stripe.prices.retrieve(priceId);
  const terms = matchesProPrice(price, pricing.pro.cents) ? pricing.pro
    : originalPrice && matchesProPrice(price, legacyProPricing.cents) ? legacyProPricing : null;
  if (!terms || invoice.total !== terms.cents || line.amount !== terms.cents) throw verifiedPaymentError();

  const intent = paid ? await proPaymentIntent(stripe, invoice, checkout.customerId, terms.cents) : null;
  if (intent) await applyRefund(intent, await successfulRefundAmount(stripe, intent));
  const paidAt = invoice.status_transitions.paid_at;
  if (paid && !paidAt) throw verifiedPaymentError();
  const result = await recordProInvoice({ invoiceId: invoice.id, subscriptionId, event, paymentIntentId: intent,
    periodStart: iso(line.period.start), periodEnd: iso(line.period.end),
    createdAt: iso(invoice.created), paidAt: paid && paidAt ? iso(paidAt) : null, amount: terms.cents, credits: terms.scans });
  if (result === "mismatch") throw verifiedPaymentError();
}

async function handleRefund(stripe: Stripe, event: Stripe.Event) {
  const resource = event.data.object as Stripe.Refund | Stripe.Charge;
  const intentId = stripeId(resource.payment_intent);
  if (!intentId) return;
  const db = database();
  const { rows } = await db.execute<{ known: boolean }>(sql`select (
    exists (select 1 from scan_purchases where payment_intent_id = ${intentId}) or
    exists (select 1 from pro_invoices where payment_intent_id = ${intentId})
  ) as known`);
  if (!rows[0].known) {
    // The refund can arrive ahead of its payment. Confirm this payment belongs
    // to a customer or a legacy purchase created by this application.
    const intent = await stripe.paymentIntents.retrieve(intentId);
    const customer = stripeId(intent.customer);
    const [account] = customer ? await db.select({ id: scanAccounts.userId }).from(scanAccounts)
      .where(eq(scanAccounts.stripeCustomerId, customer)).limit(1) : [];
    if (!account) {
      const legacy = requestIdSchema.safeParse(intent.metadata?.purchaseId);
      if (!legacy.success || intent.metadata?.pack !== SCAN_PACK.code) return;
      const [purchase] = await db.select({ userId: scanPurchases.userId }).from(scanPurchases)
        .where(and(eq(scanPurchases.id, legacy.data), eq(scanPurchases.packCode, SCAN_PACK.code))).limit(1);
      if (!purchase || purchase.userId !== intent.metadata.userId) return;
    }
  }
  await applyRefund(intentId, await successfulRefundAmount(stripe, intentId), event);
}

export async function processStripeEvent(stripe: Stripe, event: Stripe.Event) {
  switch (event.type) {
    case "checkout.session.completed":
    case "checkout.session.async_payment_succeeded":
    case "checkout.session.async_payment_failed":
    case "checkout.session.expired":
      return handleCheckout(stripe, event);
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const snapshot = event.data.object;
      if (!snapshot.metadata?.kaloProCheckout) return;
      const subscription = event.type === "customer.subscription.deleted" ? snapshot : await stripe.subscriptions.retrieve(snapshot.id);
      await subscriptionFromStripe(subscription, event);
      return;
    }
    case "invoice.paid":
    case "invoice.payment_failed":
      return handleInvoice(stripe, event);
    case "charge.refunded":
    case "refund.created":
    case "refund.updated":
      return handleRefund(stripe, event);
  }
}
