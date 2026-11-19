import { sql } from "drizzle-orm";
import { database } from "@/db";
import type { FoodPhotoResult, ScanAllowance } from "./ai-types";
import type { BillingProduct } from "./pricing";
import type { Locale } from "./types";

export type ScanOperation = {
  status: "started" | "succeeded" | "failed" | "busy" | "no_credits" | "conflict" | "rate_limited" | "expired";
  credits: number;
  result?: FoodPhotoResult;
  saved?: boolean;
};

// Each function locks the user's account row and commits all related mutations together.
// This works with Neon HTTP without an interactive transaction or an external lock service.
export async function beginScan(userId: string, id: string, inputHash: string, token: string) {
  const rows = await database().execute(sql`select kalo_begin_scan(${userId}::uuid, ${id}::uuid, ${inputHash}, ${token}::uuid) as outcome`);
  return rows.rows[0].outcome as ScanOperation;
}

export async function completeScan(userId: string, id: string, token: string, result: FoodPhotoResult) {
  const rows = await database().execute(sql`select kalo_complete_scan(${userId}::uuid, ${id}::uuid, ${token}::uuid, ${JSON.stringify(result)}::jsonb) as outcome`);
  return rows.rows[0].outcome as ScanOperation;
}

export async function failScan(userId: string, id: string, token: string) {
  await database().execute(sql`select kalo_fail_scan(${userId}::uuid, ${id}::uuid, ${token}::uuid)`);
}

export async function creditPurchase(input: {
  userId: string; purchaseId: string; sessionId: string; paymentIntentId: string;
  eventId: string; eventType: string; amount: number; currency: string;
}) {
  const p = input;
  const rows = await database().execute(sql`select kalo_credit_purchase(
    ${p.userId}::uuid, ${p.purchaseId}::uuid, ${p.sessionId}, ${p.paymentIntentId},
    ${p.eventId}, ${p.eventType}, ${p.amount}, ${p.currency}) as outcome`);
  return rows.rows[0].outcome as { status: "credited" | "duplicate" | "mismatch"; credits?: number };
}

type BillingEvent = { id: string; type: string };

export async function scanBalance(userId: string) {
  const { rows } = await database().execute<{ balance: (ScanAllowance & { hasStripeCustomer: boolean; invoiceId: string | null }) | null }>(
    sql`select kalo_scan_balance(${userId}::uuid) as balance`,
  );
  return rows[0].balance;
}

type CheckoutReservation = {
  status: "pending" | "paid" | "completed" | "expired" | "failed" | "refunded" | "subscribed" | "conflict" | "rate_limited";
  id?: string;
  priceId?: string;
  sessionId?: string | null;
  locale?: Locale;
  expiresAt?: number;
};

export async function reserveCheckout(userId: string, id: string, product: BillingProduct, priceId: string, locale: Locale) {
  const db = database();
  const { rows } = product === "pro"
    ? await db.execute<{ outcome: CheckoutReservation }>(
      sql`select kalo_reserve_pro_checkout(${userId}::uuid, ${id}::uuid, ${priceId}, ${locale}) as outcome`,
    )
    : await db.execute<{ outcome: CheckoutReservation }>(
      sql`select kalo_start_pack(${userId}::uuid, ${id}::uuid, ${product}, ${priceId}, ${locale}) as outcome`,
    );
  return rows[0].outcome;
}

export async function syncProSubscription(input: {
  userId: string; checkoutId: string; customerId: string; subscriptionId: string; status: string;
  createdAt: string; periodEnd: string | null; cancelAt: string | null; eventAt: string;
}) {
  const p = input;
  const { rows } = await database().execute<{ synced: boolean }>(sql`select kalo_sync_pro_subscription(
    ${p.userId}::uuid, ${p.checkoutId}::uuid, ${p.customerId}, ${p.subscriptionId}, ${p.status},
    ${p.createdAt}::timestamptz, ${p.periodEnd}::timestamptz, ${p.cancelAt}::timestamptz,
    ${p.eventAt}::timestamptz) as synced`);
  return rows[0].synced;
}

export async function recordProInvoice(input: {
  invoiceId: string; subscriptionId: string; paymentIntentId: string | null; event: BillingEvent;
  periodStart: string; periodEnd: string; createdAt: string; paidAt: string | null; amount: number; credits: number;
}) {
  const p = input;
  const { rows } = await database().execute<{ outcome: "recorded" | "duplicate" | "mismatch" }>(sql`select kalo_record_pro_invoice(
    ${p.invoiceId}, ${p.subscriptionId}, ${p.paymentIntentId}, ${p.event.id}, ${p.event.type},
    ${p.periodStart}::timestamptz, ${p.periodEnd}::timestamptz, ${p.createdAt}::timestamptz, ${p.paidAt}::timestamptz,
    ${p.amount}, ${p.credits}) as outcome`);
  return rows[0].outcome;
}

export async function applyRefund(intent: string, amount: number, event?: BillingEvent) {
  if (amount < 1) return;
  await database().execute(sql`select kalo_apply_scan_refund(${intent}, ${amount}, ${event?.id ?? null}, ${event?.type ?? null})`);
}
