import type { NextRequest } from "next/server";
import { count, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";
import { database } from "@/db";
import { sessions, users } from "@/db/schema";
import { isAdminUser } from "@/lib/admin-access";
import { currentUser } from "@/lib/server-auth";
import { isAiDatabaseReady } from "@/lib/ai-setup";
import { privateJson } from "@/lib/ai-http";
import { availableBillingProducts } from "@/lib/stripe";

export const runtime = "nodejs";
const pageSize = 25;
const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(10000),
  search: z.string().trim().max(180),
});

export async function GET(req: NextRequest) {
  try {
    const viewer = await currentUser();
    if (!viewer) return privateJson({ error: "sessionEnded" }, 401);
    if (!isAdminUser(viewer.id)) return privateJson({ error: "adminForbidden" }, 403);

    const params = req.nextUrl.searchParams;
    const input = querySchema.safeParse({ page: params.get("page") ?? "1", search: params.get("search") ?? "" });
    if (!input.success) return privateJson({ error: "formError" }, 400);
    const { page, search } = input.data;
    const db = database();
    const scanReady = await isAiDatabaseReady(db);
    const filter = search ? or(
      sql`strpos(lower(${users.name}), lower(${search})) > 0`,
      sql`strpos(lower(${users.email}), lower(${search})) > 0`,
    ) : undefined;
    const activeSession = db.select({
      startedAt: sql<Date | null>`case when ${sessions.expiresAt} > now() then ${sessions.createdAt} end`,
    }).from(sessions).where(eq(sessions.userId, users.id))
      .orderBy(desc(sessions.createdAt), desc(sessions.id)).limit(1);

    const selection = db.select({
      id: users.id, name: users.name, email: users.email, createdAt: users.createdAt,
      sessionStartedAt: sql<Date | null>`(${activeSession})`.mapWith(sessions.createdAt),
      scanCredits: scanReady ? sql<number | null>`(kalo_scan_balance(${users.id})->>'credits')::integer` : sql<number | null>`null`,
    }).from(users);
    const [rows, [summary]] = await Promise.all([
      selection.where(filter).orderBy(desc(users.createdAt), desc(users.id))
        .limit(pageSize + 1).offset((page - 1) * pageSize),
      db.select({ total: count() }).from(users).where(filter),
    ]);
    return privateJson({
      users: rows.slice(0, pageSize), total: summary.total, page, hasMore: rows.length > pageSize,
      scannerSetup: {
        database: scanReady,
        openAi: Boolean(process.env.OPENAI_API_KEY),
        stripe: availableBillingProducts().length === 3,
      },
    });
  } catch (error) {
    console.error("KALO admin user list failed", error instanceof Error ? error.name : "UnknownError");
    return privateJson({ error: "adminUnavailable" }, 503);
  }
}
