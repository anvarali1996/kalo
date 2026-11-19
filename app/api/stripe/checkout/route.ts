import { NextRequest } from "next/server";
import { and, eq, or, isNull } from "drizzle-orm";
import Stripe from "stripe";
import { database } from "@/db";
import { scanPurchases } from "@/db/schema";
import { currentUser } from "@/lib/server-auth";
import { checkOrigin } from "@/lib/http";
import { aiFail, aiHandleError, limitedBody, privateJson } from "@/lib/ai-http";
import { checkoutSchema } from "@/lib/ai-validation";
import { appName } from "@/lib/brand";
import { appOrigin, SCAN_PACK, stripeClient } from "@/lib/stripe";
import { startPurchase } from "@/lib/scan-accounting";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return aiFail("aiLoginRequired", 401);
    if (!process.env.STRIPE_WEBHOOK_SECRET) return aiFail("aiCheckoutUnavailable", 503);
    const input = checkoutSchema.parse(JSON.parse(await limitedBody(req, 2048)));
    const stripe = stripeClient();
    const origin = appOrigin();
    const purchase = await startPurchase(user.id, input.requestId);
    if (purchase.status === "rate_limited") return aiFail("aiRateLimited", 429);
    if (purchase.status !== "pending") return aiFail("aiCheckoutFinished", 409);
    const createSession = (name: string) => stripe.checkout.sessions.create({
      mode: "payment",
      adaptive_pricing: { enabled: false },
      automatic_tax: { enabled: false },
      client_reference_id: user.id,
      customer_email: user.email,
      locale: input.locale === "lv" || input.locale === "uz" ? "en" : input.locale,
      line_items: [{ price_data: { currency: SCAN_PACK.currency, unit_amount: SCAN_PACK.amount,
        tax_behavior: "inclusive", product_data: { name } }, quantity: 1 }],
      metadata: { userId: user.id, purchaseId: input.requestId, pack: SCAN_PACK.code },
      payment_intent_data: { metadata: { userId: user.id, purchaseId: input.requestId, pack: SCAN_PACK.code } },
      success_url: `${origin}/?checkout=success&purchase=${input.requestId}`,
      cancel_url: `${origin}/?checkout=cancel&purchase=${input.requestId}`,
      allow_promotion_codes: false,
    }, { idempotencyKey: `kalo-scans:${input.requestId}` });
    const session = purchase.sessionId ? await stripe.checkout.sessions.retrieve(purchase.sessionId)
      : await createSession(`${appName} · 5 AI food scans`).catch((error: unknown) => {
        // Recover a session Stripe created before the rename using its original parameters.
        if (error instanceof Stripe.errors.StripeIdempotencyError && error.statusCode !== 409) {
          return createSession("KALO · 5 AI food scans");
        }
        throw error;
      });
    if (session.status !== "open" || !session.url) return aiFail("aiCheckoutFinished", 409);
    const attached = await database().update(scanPurchases).set({ checkoutSessionId: session.id })
      .where(and(eq(scanPurchases.id, input.requestId), eq(scanPurchases.userId, user.id),
        or(isNull(scanPurchases.checkoutSessionId), eq(scanPurchases.checkoutSessionId, session.id))))
      .returning({ id: scanPurchases.id });
    if (!attached.length) return aiFail("aiCheckoutFinished", 409);
    return privateJson({ url: session.url });
  } catch (error) { return aiHandleError(error); }
}
