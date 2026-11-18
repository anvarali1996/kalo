import type Stripe from "stripe";
import { and, eq, ne, or, isNull } from "drizzle-orm";
import { database } from "@/db";
import { scanPurchases, stripeWebhookEvents } from "@/db/schema";
import { requestIdSchema } from "@/lib/ai-validation";
import { aiFail, aiHandleError, limitedBody, privateJson } from "@/lib/ai-http";
import { creditPurchase } from "@/lib/scan-accounting";
import { SCAN_PACK, stripeClient, validPaidSession } from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;

const handled = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded", "checkout.session.async_payment_failed", "checkout.session.expired"]);

export async function POST(req: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET) return aiFail("aiCheckoutUnavailable", 503);
  let event: Stripe.Event;
  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return aiFail("invalid_signature", 400);
    const raw = await limitedBody(req, 1_000_000);
    // Verify the ORIGINAL body before parsing JSON. Stripe enforces timestamp tolerance.
    event = stripeClient().webhooks.constructEvent(raw, signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch { return aiFail("invalid_signature", 400); }
  if (!handled.has(event.type)) return privateJson({ received: true });
  try {
    const eventSession = event.data.object as Stripe.Checkout.Session;
    if (eventSession.metadata?.pack !== SCAN_PACK.code) return privateJson({ received: true });
    const purchaseId = requestIdSchema.safeParse(eventSession.metadata.purchaseId);
    if (!purchaseId.success) return aiFail("invalid_purchase", 400);
    const db = database();
    const [purchase] = await db.select().from(scanPurchases).where(eq(scanPurchases.id, purchaseId.data)).limit(1);
    if (!purchase) return aiFail("purchase_not_found", 409);
    if (eventSession.metadata.userId !== purchase.userId || eventSession.client_reference_id !== purchase.userId ||
        (purchase.checkoutSessionId && purchase.checkoutSessionId !== eventSession.id)) return aiFail("purchase_mismatch", 400);
    // Retrieve Stripe's current state; never trust browser query parameters or a success redirect.
    const session = await stripeClient().checkout.sessions.retrieve(eventSession.id, { expand: ["line_items"] });
    if (session.payment_status === "paid") {
      if (!validPaidSession(session, purchase)) return aiFail("payment_mismatch", 400);
      const paymentIntentId = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent!.id;
      const result = await creditPurchase({ userId: purchase.userId, purchaseId: purchase.id, sessionId: session.id,
        paymentIntentId, eventId: event.id, eventType: event.type, amount: session.amount_total!, currency: session.currency! });
      if (result.status === "mismatch") return aiFail("purchase_mismatch", 400);
    } else if (event.type === "checkout.session.expired" || event.type === "checkout.session.async_payment_failed") {
      await db.batch([
        db.update(scanPurchases).set({ status: event.type.endsWith("expired") ? "expired" : "failed", checkoutSessionId: session.id })
          .where(and(eq(scanPurchases.id, purchase.id), ne(scanPurchases.status, "paid"),
            or(isNull(scanPurchases.checkoutSessionId), eq(scanPurchases.checkoutSessionId, session.id)))),
        db.insert(stripeWebhookEvents).values({ id: event.id, type: event.type }).onConflictDoNothing(),
      ]);
    }
    return privateJson({ received: true });
  } catch (error) { return aiHandleError(error); } // Non-2xx lets Stripe retry transient failures.
}
