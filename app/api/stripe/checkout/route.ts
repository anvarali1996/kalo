import { NextRequest } from "next/server";
import { and, eq, isNull, or } from "drizzle-orm";
import { database } from "@/db";
import { proCheckouts, scanPurchases } from "@/db/schema";
import { currentUser } from "@/lib/server-auth";
import { checkOrigin } from "@/lib/http";
import { aiFail, aiHandleError, limitedBody, privateJson } from "@/lib/ai-http";
import { checkoutSchema } from "@/lib/ai-validation";
import { reserveCheckout } from "@/lib/scan-accounting";
import {
  appOrigin, blocksNewProCheckout, ensureStripeCustomer, requireStripePrice, stripeCheckoutLocale,
  stripeClient, stripeId, stripePriceId, stripeReady,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return aiFail("aiLoginRequired", 401);
    const { requestId, locale, product } = checkoutSchema.parse(JSON.parse(await limitedBody(req, 2048)));
    const priceId = stripePriceId(product);
    if (!stripeReady() || !priceId) return aiFail("aiCheckoutUnavailable", 503);
    const stripe = stripeClient();
    const origin = appOrigin();
    await requireStripePrice(stripe, priceId, product);
    const reservation = await reserveCheckout(user.id, requestId, product, priceId, locale);
    if (reservation.status === "rate_limited") return aiFail("billingCheckoutLimit", 429);
    if (reservation.status === "subscribed") return aiFail("billingAlreadySubscribed", 409);
    if (reservation.status !== "pending" || !reservation.priceId || !reservation.locale) return aiFail("aiCheckoutFinished", 409);
    const pro = product === "pro";
    // An open Checkout keeps its original Stripe price until it expires.
    if (pro && reservation.priceId !== priceId) return aiFail("aiCheckoutFinished", 409);

    const customer = await ensureStripeCustomer(stripe, user);
    const id = reservation.id ?? requestId;
    const metadata: Record<string, string> = pro ? { kaloProCheckout: id, userId: user.id }
      : { purchaseId: id, pack: product, userId: user.id };
    let session;
    if (reservation.sessionId) {
      session = await stripe.checkout.sessions.retrieve(reservation.sessionId);
    } else {
      if (reservation.priceId !== priceId) await requireStripePrice(stripe, reservation.priceId, product);
      if (pro) {
        // An earlier Checkout can finish before its webhooks are delivered.
        for await (const subscription of stripe.subscriptions.list({ customer, status: "all", limit: 100 })) {
          if (blocksNewProCheckout(subscription.status)) return aiFail("billingAlreadySubscribed", 409);
        }
      }
      session = await stripe.checkout.sessions.create({
        mode: pro ? "subscription" : "payment",
        customer, client_reference_id: user.id, metadata,
        locale: stripeCheckoutLocale(reservation.locale),
        allowed_payment_method_types: ["card"],
        adaptive_pricing: { enabled: false }, automatic_tax: { enabled: false }, allow_promotion_codes: false,
        line_items: [{ price: reservation.priceId, quantity: 1 }],
        success_url: `${origin}/?checkout=success&${pro ? "pro" : "purchase"}=${id}`,
        cancel_url: `${origin}/?checkout=cancel`,
        ...(pro ? { subscription_data: { metadata }, expires_at: reservation.expiresAt }
          : { payment_intent_data: { metadata } }),
      }, { idempotencyKey: `kalo-${pro ? "pro" : "pack"}:${id}` });
    }

    if (stripeId(session.customer) !== customer || session.client_reference_id !== user.id ||
        session.metadata?.userId !== user.id ||
        (pro ? session.metadata?.kaloProCheckout !== id : session.metadata?.purchaseId !== id)) {
      return aiFail("aiCheckoutUnavailable", 503);
    }
    const db = database();
    const table = pro ? proCheckouts : scanPurchases;
    if (session.status === "expired") {
      await db.update(table).set({ status: "expired", checkoutSessionId: session.id })
        .where(and(eq(table.id, id), eq(table.userId, user.id), eq(table.status, "pending"),
          or(isNull(table.checkoutSessionId), eq(table.checkoutSessionId, session.id))));
      return aiFail("aiCheckoutFinished", 409);
    }
    if (session.status !== "open" || !session.url) return aiFail("aiCheckoutFinished", 409);
    const attached = await db.update(table).set({ checkoutSessionId: session.id })
      .where(and(eq(table.id, id), eq(table.userId, user.id), eq(table.status, "pending"),
        or(isNull(table.checkoutSessionId), eq(table.checkoutSessionId, session.id))))
      .returning({ id: table.id });
    if (!attached.length) return aiFail("aiCheckoutFinished", 409);
    return privateJson({ url: session.url });
  } catch (error) { return aiHandleError(error); }
}
