import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "@/db";
import { currentUser } from "@/lib/server-auth";
import { aiFail, aiHandleError, privateJson } from "@/lib/ai-http";
import { isAiDatabaseReady } from "@/lib/ai-setup";
import { scanBalance } from "@/lib/scan-accounting";
import { availableBillingProducts } from "@/lib/stripe";
import { publicAppOrigin } from "@/lib/http";
import type { ScanPurchase } from "@/lib/ai-types";

export const runtime = "nodejs";
const pageSize = 10;

export async function GET(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) return aiFail("aiLoginRequired", 401);
    const page = z.coerce.number().int().min(1).max(10000).parse(req.nextUrl.searchParams.get("page") ?? 1);
    const db = database();
    if (!(await isAiDatabaseReady(db))) return aiFail("aiStorageUnavailable", 503);
    const [balance, history] = await Promise.all([
      scanBalance(user.id),
      db.execute<ScanPurchase & Record<string, unknown>>(sql`
        select id, kind, credits, amount, currency, status,
          created_at as "createdAt", paid_at as "paidAt", refunded_amount as "refundedAmount"
        from (
          select id::text, 'pack' as kind, credits, amount, currency, status, created_at, paid_at, refunded_amount
          from scan_purchases where user_id = ${user.id}::uuid
          union all
          select i.id, 'pro', i.credits, i.amount, 'eur',
            case when i.refunded_amount = i.amount then 'refunded' else i.status end,
            i.created_at, i.paid_at, i.refunded_amount
          from pro_invoices i join pro_subscriptions s on s.id = i.subscription_id where s.user_id = ${user.id}::uuid
        ) payments
        order by created_at desc, id desc limit ${pageSize + 1} offset ${(page - 1) * pageSize}
      `),
    ]);
    if (!balance) return aiFail("aiStorageUnavailable", 503);
    const { hasStripeCustomer, invoiceId: _invoiceId, ...allowance } = balance;
    return privateJson({ ...allowance, purchases: history.rows.slice(0, pageSize), hasMore: history.rows.length > pageSize,
      scanningAvailable: Boolean(process.env.OPENAI_API_KEY), availableProducts: availableBillingProducts(),
      portalAvailable: hasStripeCustomer && Boolean(process.env.STRIPE_SECRET_KEY && publicAppOrigin()),
    });
  } catch (error) { return aiHandleError(error); }
}
