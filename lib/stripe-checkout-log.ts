import Stripe from "stripe";
import { NeonDbError } from "@neondatabase/serverless";
import { DrizzleQueryError } from "drizzle-orm/errors";
import { AiError, databaseErrorCode } from "./ai-http";

export type StripeCustomerStage = "stripe_customer_lookup" | "stripe_customer_create" | "stripe_customer_attach";

export type StripeCheckoutStage = StripeCustomerStage | "authenticate" | "validate_request" | "stripe_configuration" |
  "stripe_price_retrieve" | "checkout_reservation" | "checkout_reservation_expire" | "stripe_subscription_list" |
  "checkout_session_retrieve" | "checkout_session_create" | "checkout_session_validate" | "checkout_session_attach";

const stripeTypes = new Set([
  "StripeInvalidRequestError", "StripeAuthenticationError", "StripePermissionError", "StripeAPIError",
  "StripeConnectionError", "StripeIdempotencyError", "StripeRateLimitError", "StripeCardError",
]);
const stripeCodes = new Set([
  "resource_missing", "parameter_unknown", "parameter_invalid_integer", "parameter_invalid_enum",
  "payment_method_unactivated", "idempotency_key_in_use", "rate_limit",
]);
const stripeParams = new Set([
  "expires_at", "customer", "locale", "line_items[0][price]",
  "payment_method_types", "allowed_payment_method_types", "adaptive_pricing",
]);

export function logStripeCheckoutFailure(stage: StripeCheckoutStage, error: unknown) {
  const stripe = error instanceof Stripe.errors.StripeError ? error : undefined;
  const errorType = stripe ? "StripeError"
    : error instanceof DrizzleQueryError ? "DrizzleQueryError"
    : error instanceof NeonDbError ? "NeonDbError"
    : error instanceof AiError ? "AiError"
    : error instanceof TypeError ? "TypeError"
    : error instanceof Error ? "Error" : "UnknownError";
  const status = stripe?.statusCode;

  // Never serialize an exception, message, stack, or provider response.
  console.error("KALO Stripe checkout failed", {
    stage, errorType,
    postgresCode: stripe ? undefined : databaseErrorCode(error),
    stripeType: stripe && (stripeTypes.has(stripe.type) ? stripe.type : "StripeError"),
    stripeStatus: typeof status === "number" && Number.isInteger(status) && status >= 400 && status <= 599 ? status : undefined,
    stripeCode: stripe?.code && stripeCodes.has(stripe.code) ? stripe.code : undefined,
    stripeParameter: stripe?.param && stripeParams.has(stripe.param) ? stripe.param : undefined,
  });
}
