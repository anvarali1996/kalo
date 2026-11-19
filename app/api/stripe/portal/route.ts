import type { NextRequest } from "next/server";
import { z } from "zod";
import { aiFail, aiHandleError, limitedBody, privateJson } from "@/lib/ai-http";
import { localeSchema } from "@/lib/ai-validation";
import { checkOrigin } from "@/lib/http";
import { currentUser } from "@/lib/server-auth";
import { appOrigin, storedStripeCustomer, stripeCheckoutLocale, stripeClient } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return aiFail("aiLoginRequired", 401);
    const { locale } = z.object({ locale: localeSchema }).strict().parse(JSON.parse(await limitedBody(req, 1024)));
    const customer = await storedStripeCustomer(user.id);
    if (!customer) return aiFail("billingPortalUnavailable", 409);
    const session = await stripeClient().billingPortal.sessions.create({
      customer, locale: stripeCheckoutLocale(locale), return_url: `${appOrigin()}/?billing=1`,
      configuration: process.env.STRIPE_PORTAL_CONFIGURATION_ID || undefined,
    });
    return privateJson({ url: session.url });
  } catch (error) { return aiHandleError(error); }
}
