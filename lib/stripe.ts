import Stripe from "stripe";
import { and, eq, isNull } from "drizzle-orm";
import { database } from "@/db";
import { scanAccounts, scanPurchases } from "@/db/schema";
import { AiError } from "./ai-http";
import { publicAppOrigin } from "./http";
import { billingProducts, pricing, type BillingProduct } from "./pricing";
import type { Locale, SessionUser } from "./types";

export const SCAN_PACK = { credits: 5, amount: 499, currency: "eur", code: "kalo_5_scans_v1" } as const;

export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new AiError("aiCheckoutUnavailable", 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 1, timeout: 12_000 });
}

export function appOrigin() {
  const origin = publicAppOrigin();
  if (!origin) throw new AiError("aiCheckoutUnavailable", 503);
  return origin;
}

export function stripeReady() {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && publicAppOrigin());
}

export function stripePriceId(product: BillingProduct) {
  const value = {
    pro: process.env.STRIPE_PRO_PRICE_ID,
    pack20: process.env.STRIPE_PACK20_PRICE_ID,
    pack50: process.env.STRIPE_PACK50_PRICE_ID,
  }[product]?.trim();
  return value && /^price_[a-zA-Z0-9_]+$/.test(value) ? value : null;
}

export function availableBillingProducts() {
  return stripeReady() ? billingProducts.filter(product => stripePriceId(product)) : [];
}

export function stripeId(resource: string | { id: string } | null | undefined) {
  return typeof resource === "string" ? resource : resource?.id ?? null;
}

export function stripeCheckoutLocale(locale: Locale) {
  return locale === "uz" ? "en" : locale;
}

export function blocksNewProCheckout(status: Stripe.Subscription.Status) {
  return status !== "canceled" && status !== "incomplete_expired";
}

export function matchesProPrice(price: Stripe.Price, cents: number) {
  return price.currency === "eur" && price.unit_amount === cents && price.type === "recurring" &&
    price.recurring?.interval === "month" && price.recurring.interval_count === 1 && price.recurring.usage_type === "licensed";
}

export function matchesPrice(price: Stripe.Price, product: BillingProduct) {
  return product === "pro" ? matchesProPrice(price, pricing.pro.cents)
    : price.currency === "eur" && price.unit_amount === pricing[product].cents && price.type === "one_time";
}

export async function requireStripePrice(stripe: Stripe, priceId: string, product: BillingProduct) {
  const price = await stripe.prices.retrieve(priceId);
  if (!price.active || !matchesPrice(price, product)) throw new AiError("aiCheckoutUnavailable", 503);
}

export async function storedStripeCustomer(userId: string) {
  const [account] = await database().select({ id: scanAccounts.stripeCustomerId })
    .from(scanAccounts).where(eq(scanAccounts.userId, userId)).limit(1);
  if (!account) throw new AiError("aiStorageUnavailable", 503);
  return account.id;
}

export async function ensureStripeCustomer(stripe: Stripe, user: SessionUser) {
  const existing = await storedStripeCustomer(user.id);
  if (existing) return existing;
  const created = await stripe.customers.create({
    email: user.email, metadata: { kaloUserId: user.id },
  }, { idempotencyKey: `kalo-customer:${user.id}` });
  const [attached] = await database().update(scanAccounts).set({ stripeCustomerId: created.id })
    .where(and(eq(scanAccounts.userId, user.id), isNull(scanAccounts.stripeCustomerId)))
    .returning({ id: scanAccounts.stripeCustomerId });
  const customer = attached?.id ?? await storedStripeCustomer(user.id);
  if (!customer) throw new AiError("aiStorageUnavailable", 503);
  return customer;
}

type PackPurchase = Pick<typeof scanPurchases.$inferSelect,
  "id" | "userId" | "checkoutSessionId" | "packCode" | "stripePriceId" | "amount" | "currency">;

export function matchesPackSession(session: Stripe.Checkout.Session, purchase: PackPurchase, customerId: string | null) {
  return session.mode === "payment" &&
    session.metadata?.purchaseId === purchase.id && session.metadata?.userId === purchase.userId &&
    session.metadata?.pack === purchase.packCode && session.client_reference_id === purchase.userId &&
    (!purchase.checkoutSessionId || purchase.checkoutSessionId === session.id) &&
    (purchase.packCode === SCAN_PACK.code || (customerId !== null && stripeId(session.customer) === customerId));
}

export function validPaidSession(session: Stripe.Checkout.Session, purchase: PackPurchase, customerId: string | null) {
  const item = session.line_items?.data[0];
  return matchesPackSession(session, purchase, customerId) &&
    session.status === "complete" && session.payment_status === "paid" &&
    session.amount_total === purchase.amount && session.amount_subtotal === purchase.amount && session.currency === purchase.currency &&
    Boolean(stripeId(session.payment_intent)) && session.line_items?.data.length === 1 && !session.line_items.has_more &&
    item?.quantity === 1 && item.price?.unit_amount === purchase.amount && item.price.currency === purchase.currency &&
    !item.price.recurring && (!purchase.stripePriceId || item.price.id === purchase.stripePriceId);
}
