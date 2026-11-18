import { and, eq } from "drizzle-orm";
import { database } from "@/db";
import { aiScans, scanAccounts } from "@/db/schema";
import { currentUser } from "@/lib/server-auth";
import { aiFail, aiHandleError, privateJson } from "@/lib/ai-http";
import { requestIdSchema } from "@/lib/ai-validation";

export const runtime = "nodejs";

export async function GET(_req: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await currentUser();
    if (!user) return aiFail("aiLoginRequired", 401);
    const id = requestIdSchema.parse((await context.params).id);
    const [scan] = await database().select({
      status: aiScans.status, result: aiScans.result, savedAt: aiScans.savedAt,
      leaseExpiresAt: aiScans.leaseExpiresAt, credits: scanAccounts.credits,
    }).from(aiScans).innerJoin(scanAccounts, eq(scanAccounts.userId, aiScans.userId))
      .where(and(eq(aiScans.id, id), eq(aiScans.userId, user.id))).limit(1);
    if (!scan) return aiFail("aiScanNotFound", 404);
    const status = scan.status === "processing" && scan.leaseExpiresAt <= new Date() ? "failed" : scan.status;
    return privateJson({ id, status, result: scan.result, credits: scan.credits, saved: !!scan.savedAt });
  } catch (error) { return aiHandleError(error); }
}
