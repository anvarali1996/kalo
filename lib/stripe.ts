import Stripe from "stripe";
import { AiError } from "./ai-http";

export const SCAN_PACK = { credits: 5, amount: 499, currency: "eur", code: "kalo_5_scans_v1" } as const;

export function stripeClient() {
  if (!process.env.STRIPE_SECRET_KEY) throw new AiError("aiCheckoutUnavailable", 503);
  return new Stripe(process.env.STRIPE_SECRET_KEY, { maxNetworkRetries: 2, timeout: 15_000 });
}

export function appOrigin() {
  let url: URL;
  try { url = new URL(process.env.APP_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000")); }
  catch { throw new AiError("aiCheckoutUnavailable", 503); }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
      (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
    throw new AiError("aiCheckoutUnavailable", 503);
  }
  return url.origin;
}

export function validPaidSession(session: Stripe.Checkout.Session, purchase: { id: string; userId: string; checkoutSessionId: string | null }) {
  const item = session.line_items?.data[0];
  return session.mode === "payment" && session.status === "complete" && session.payment_status === "paid" &&
    session.amount_total === SCAN_PACK.amount && session.amount_subtotal === SCAN_PACK.amount && session.currency === SCAN_PACK.currency &&
    session.metadata?.purchaseId === purchase.id && session.metadata?.userId === purchase.userId &&
    session.metadata?.pack === SCAN_PACK.code && session.client_reference_id === purchase.userId &&
    (!purchase.checkoutSessionId || purchase.checkoutSessionId === session.id) &&
    !!session.payment_intent && session.line_items?.data.length === 1 && !session.line_items.has_more &&
    item?.quantity === 1 && item.price?.unit_amount === SCAN_PACK.amount &&
    item.price.currency === SCAN_PACK.currency && !item.price.recurring;
}
