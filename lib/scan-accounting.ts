import { sql } from "drizzle-orm";
import { database } from "@/db";
import type { FoodPhotoResult } from "./ai-types";

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

export async function startPurchase(userId: string, id: string) {
  const rows = await database().execute(sql`select kalo_start_purchase(${userId}::uuid, ${id}::uuid) as outcome`);
  return rows.rows[0].outcome as { status: "pending" | "paid" | "expired" | "failed" | "rate_limited" | "conflict"; sessionId: string | null };
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
