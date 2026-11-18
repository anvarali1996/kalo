import { NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { database } from "@/db";
import { currentUser } from "@/lib/server-auth";
import { checkOrigin } from "@/lib/http";
import { aiFail, aiHandleError, limitedBody, privateJson } from "@/lib/ai-http";
import { requestIdSchema, savePhotoScanSchema } from "@/lib/ai-validation";
import type { DiaryItem } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: NextRequest, context: { params: Promise<{ id: string }> }) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return aiFail("aiLoginRequired", 401);
    const id = requestIdSchema.parse((await context.params).id);
    const input = savePhotoScanSchema.parse(JSON.parse(await limitedBody(req, 4096)));
    const rows = await database().execute(sql`select kalo_save_ai_scan(${user.id}::uuid, ${id}::uuid, ${input.date}, ${JSON.stringify(input.portions)}::jsonb) as outcome`);
    const outcome = rows.rows[0].outcome as { status: string; entries: DiaryItem[] };
    if (outcome.status === "not_found") return aiFail("aiScanNotFound", 404);
    if (outcome.status !== "saved") return aiFail("aiInvalidPortions");
    return privateJson({ entries: outcome.entries });
  } catch (error) { return aiHandleError(error); }
}
