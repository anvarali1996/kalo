import type Stripe from "stripe";
import { aiFail, aiHandleError, limitedBody, privateJson } from "@/lib/ai-http";
import { stripeClient } from "@/lib/stripe";
import { processStripeEvent } from "@/lib/stripe-webhooks";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: Request) {
  if (!process.env.STRIPE_WEBHOOK_SECRET || !process.env.STRIPE_SECRET_KEY) return aiFail("aiCheckoutUnavailable", 503);
  const stripe = stripeClient();
  let event: Stripe.Event;
  try {
    const signature = req.headers.get("stripe-signature");
    if (!signature) return aiFail("invalid_signature", 400);
    // Signature verification requires the original body and Stripe's timestamp check.
    event = stripe.webhooks.constructEvent(await limitedBody(req, 1_000_000), signature, process.env.STRIPE_WEBHOOK_SECRET);
  } catch { return aiFail("invalid_signature", 400); }
  try {
    await processStripeEvent(stripe, event);
    return privateJson({ received: true });
  } catch (error) { return aiHandleError(error); }
}
