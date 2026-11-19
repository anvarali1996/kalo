import { NextRequest } from "next/server";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { database } from "@/db";
import { scanAccounts, scanPurchases } from "@/db/schema";
import { currentUser } from "@/lib/server-auth";
import { aiFail, aiHandleError, privateJson } from "@/lib/ai-http";
import { isAiDatabaseReady } from "@/lib/ai-setup";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const user = await currentUser();
    if (!user) return aiFail("aiLoginRequired", 401);
    const page = z.coerce.number().int().min(1).max(10000).parse(req.nextUrl.searchParams.get("page") || 1);
    const db = database();
    if (!(await isAiDatabaseReady(db))) {
      console.warn("KALO AI database setup incomplete");
      return aiFail("aiStorageUnavailable", 503);
    }
    const [accounts, purchases] = await Promise.all([
      db.select({ credits: scanAccounts.credits }).from(scanAccounts).where(eq(scanAccounts.userId, user.id)).limit(1),
      db.select({ id: scanPurchases.id, amount: scanPurchases.amount, currency: scanPurchases.currency,
        credits: scanPurchases.credits, status: scanPurchases.status, createdAt: scanPurchases.createdAt, paidAt: scanPurchases.paidAt,
      }).from(scanPurchases).where(eq(scanPurchases.userId, user.id)).orderBy(desc(scanPurchases.createdAt), desc(scanPurchases.id)).limit(11).offset((page - 1) * 10),
    ]);
    if (!accounts[0]) return aiFail("aiStorageUnavailable", 503);
    return privateJson({ credits: accounts[0].credits, purchases: purchases.slice(0, 10), hasMore: purchases.length > 10,
      scanningAvailable: !!process.env.OPENAI_API_KEY,
      checkoutAvailable: !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET && process.env.APP_URL),
    });
  } catch (error) { return aiHandleError(error); }
}
