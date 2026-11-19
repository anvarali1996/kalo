import { sql } from "drizzle-orm";
import { pgTable, uuid, varchar, text, timestamp, real, smallint, integer, jsonb, uniqueIndex, index, check, primaryKey, date } from "drizzle-orm/pg-core";
import type { FoodPhotoResult } from "@/lib/ai-types";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const scanAccounts = pgTable("scan_accounts", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  credits: integer("credits").default(0).notNull(),
  stripeCustomerId: text("stripe_customer_id").unique(),
}, t => [check("scan_credits_nonnegative", sql`${t.credits} >= 0`)]);

export const aiScans = pgTable("ai_scans", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  inputHash: varchar("input_hash", { length: 64 }).notNull(),
  status: varchar("status", { length: 12 }).notNull(),
  leaseToken: uuid("lease_token").notNull(),
  leaseExpiresAt: timestamp("lease_expires_at", { withTimezone: true }).notNull(),
  result: jsonb("result").$type<FoodPhotoResult>(),
  savedAt: timestamp("saved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
}, t => [
  index("ai_scans_user_created_idx").on(t.userId, t.createdAt),
  uniqueIndex("ai_scans_one_processing_per_user").on(t.userId).where(sql`${t.status} = 'processing'`),
  check("ai_scans_status_check", sql`${t.status} IN ('processing', 'succeeded', 'failed')`),
  check("ai_scans_result_check", sql`${t.status} <> 'succeeded' OR ${t.result} IS NOT NULL`),
]);

export const scanPurchases = pgTable("scan_purchases", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  checkoutSessionId: text("checkout_session_id").unique(),
  paymentIntentId: text("payment_intent_id").unique(),
  credits: integer("credits").default(5).notNull(),
  amount: integer("amount").default(499).notNull(),
  currency: varchar("currency", { length: 3 }).default("eur").notNull(),
  packCode: varchar("pack_code", { length: 20 }).default("kalo_5_scans_v1").notNull(),
  stripePriceId: text("stripe_price_id"),
  locale: varchar("locale", { length: 2 }).default("en").notNull(),
  remainingCredits: integer("remaining_credits").default(0).notNull(),
  refundedAmount: integer("refunded_amount").default(0).notNull(),
  status: varchar("status", { length: 12 }).default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, t => [
  index("scan_purchases_user_created_idx").on(t.userId, t.createdAt),
  index("scan_purchases_spend_idx").on(t.userId, t.paidAt, t.id).where(sql`${t.remainingCredits} > 0`),
  check("scan_purchase_pack_check", sql`${t.currency} = 'eur' AND (
    (${t.packCode} = 'kalo_5_scans_v1' AND ${t.credits} = 5 AND ${t.amount} = 499 AND ${t.stripePriceId} IS NULL) OR
    (${t.packCode} = 'pack20' AND ${t.credits} = 20 AND ${t.amount} = 299 AND ${t.stripePriceId} IS NOT NULL) OR
    (${t.packCode} = 'pack50' AND ${t.credits} = 50 AND ${t.amount} = 599 AND ${t.stripePriceId} IS NOT NULL))`),
  check("scan_purchase_status_check", sql`${t.status} IN ('pending', 'paid', 'expired', 'failed', 'refunded')`),
  check("scan_purchase_refund_check", sql`${t.refundedAmount} BETWEEN 0 AND ${t.amount} AND ${t.remainingCredits} BETWEEN 0 AND ${t.credits}`),
]);

export const scanCreditTransactions = pgTable("scan_credit_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  balanceAfter: integer("balance_after").notNull(),
  kind: varchar("kind", { length: 12 }).notNull(),
  reference: text("reference").notNull().unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, t => [
  index("scan_transactions_user_created_idx").on(t.userId, t.createdAt),
  check("scan_transaction_balance_check", sql`${t.balanceAfter} >= 0`),
  check("scan_transaction_delta_check", sql`(${t.kind} = 'welcome' AND ${t.delta} = 5) OR
    (${t.kind} = 'purchase' AND ${t.delta} BETWEEN 1 AND 50) OR (${t.kind} = 'pro' AND ${t.delta} BETWEEN 1 AND 120) OR
    (${t.kind} = 'refund' AND ${t.delta} BETWEEN -120 AND -1) OR (${t.kind} = 'scan' AND ${t.delta} = -1)`),
]);

export const stripeWebhookEvents = pgTable("stripe_webhook_events", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  processedAt: timestamp("processed_at", { withTimezone: true }).defaultNow().notNull(),
});

export const basicScanMonths = pgTable("basic_scan_months", {
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  monthStart: date("month_start").notNull(),
  used: smallint("used").default(0).notNull(),
}, t => [primaryKey({ columns: [t.userId, t.monthStart] }), check("basic_scan_usage_check", sql`${t.used} BETWEEN 0 AND 6`)]);

export const proCheckouts = pgTable("pro_checkouts", {
  id: uuid("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  stripePriceId: text("stripe_price_id").notNull(),
  locale: varchar("locale", { length: 2 }).notNull(),
  checkoutSessionId: text("checkout_session_id").unique(),
  status: text("status").default("pending").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [
  index("pro_checkout_user_created_idx").on(t.userId, t.createdAt),
  uniqueIndex("pro_checkout_pending_user_idx").on(t.userId).where(sql`${t.status} = 'pending'`),
  check("pro_checkout_status_check", sql`${t.status} IN ('pending', 'completed', 'expired')`),
]);

export const proSubscriptions = pgTable("pro_subscriptions", {
  id: text("id").primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  checkoutId: uuid("checkout_id").notNull().unique().references(() => proCheckouts.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  cancelAt: timestamp("cancel_at", { withTimezone: true }),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
}, t => [index("pro_subscription_user_idx").on(t.userId, t.createdAt)]);

export const proInvoices = pgTable("pro_invoices", {
  id: text("id").primaryKey(),
  subscriptionId: text("subscription_id").notNull().references(() => proSubscriptions.id, { onDelete: "cascade" }),
  paymentIntentId: text("payment_intent_id").unique(),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  status: text("status").notNull(),
  amount: integer("amount").default(999).notNull(),
  credits: smallint("credits").default(100).notNull(),
  used: smallint("used").default(0).notNull(),
  refundedAmount: integer("refunded_amount").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
  paidAt: timestamp("paid_at", { withTimezone: true }),
}, t => [
  index("pro_invoice_subscription_created_idx").on(t.subscriptionId, t.createdAt),
  uniqueIndex("pro_paid_invoice_period_idx").on(t.subscriptionId, t.periodStart).where(sql`${t.status} = 'paid'`),
  check("pro_invoice_period_check", sql`${t.periodEnd} > ${t.periodStart}`),
  check("pro_invoice_state_check", sql`(${t.status} = 'paid' AND ${t.paymentIntentId} IS NOT NULL AND ${t.paidAt} IS NOT NULL) OR
    (${t.status} = 'failed' AND ${t.paymentIntentId} IS NULL AND ${t.paidAt} IS NULL)`),
  check("pro_invoice_terms_check", sql`(${t.amount} = 999 AND ${t.credits} = 100) OR (${t.amount} = 799 AND ${t.credits} = 120)`),
  check("pro_invoice_balance_check", sql`${t.used} BETWEEN 0 AND ${t.credits} AND ${t.refundedAmount} BETWEEN 0 AND ${t.amount}`),
]);

export const stripeScanRefunds = pgTable("stripe_scan_refunds", {
  paymentIntentId: text("payment_intent_id").primaryKey(),
  amount: integer("amount").notNull(),
}, t => [check("stripe_scan_refund_amount_check", sql`${t.amount} > 0`)]);

export const passwordResetTokens = pgTable("password_reset_tokens", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
});

export const authRateLimits = pgTable("auth_rate_limits", {
  bucket: text("bucket").notNull(),
  keyHash: varchar("key_hash", { length: 64 }).notNull(),
  attempts: integer("attempts").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.bucket, t.keyHash] }), index("auth_rate_limit_expiry_idx").on(t.expiresAt)]);

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  sex: varchar("sex", { length: 10 }).notNull(),
  age: smallint("age").notNull(),
  heightCm: real("height_cm").notNull(),
  weightKg: real("weight_kg").notNull(),
  goalWeightKg: real("goal_weight_kg").notNull(),
  activity: varchar("activity", { length: 20 }).notNull(),
  weeklyGoalKg: real("weekly_goal_kg").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export function diaryEntryColumns() {
  return {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    date: varchar("date", { length: 10 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    barcode: varchar("barcode", { length: 20 }),
    grams: real("grams").notNull(),
    kcal: real("kcal").notNull(),
    protein: real("protein"),
    carbs: real("carbs"),
    fat: real("fat"),
    image: text("image"),
    source: varchar("source", { length: 10 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  };
}

export const diaryEntries = pgTable("diary_entries", {
  ...diaryEntryColumns(),
  aiScanId: uuid("ai_scan_id").references(() => aiScans.id, { onDelete: "set null" }),
}, (t) => [index("diary_user_date_idx").on(t.userId, t.date), index("diary_ai_scan_idx").on(t.aiScanId)]);

export const weightEntries = pgTable("weight_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: varchar("date", { length: 10 }).notNull(),
  kg: real("kg").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("weight_user_date_uidx").on(t.userId, t.date)]);

export type ProductSnapshot = {
  barcode: string; name: string; brand: string; image: string | null;
  kcal100: number | null; protein100: number | null; carbs100: number | null; fat100: number | null;
  sugar100: number | null; salt100: number | null; fiber100: number | null;
  nutriscore: string | null; nova: number | null; ingredients: string | null;
  allergens: string[]; serving: string | null; quantity: string | null;
};

export const productCache = pgTable("product_cache", {
  barcode: varchar("barcode", { length: 20 }).primaryKey(),
  payload: jsonb("payload").$type<ProductSnapshot>().notNull(),
  cachedAt: timestamp("cached_at", { withTimezone: true }).defaultNow().notNull(),
});
