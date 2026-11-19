import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { currentUser } from "@/lib/server-auth";
import { checkOrigin } from "@/lib/http";
import { AiError, aiHandleError, aiFail, limitedBody, privateJson } from "@/lib/ai-http";
import { MAX_SCAN_BODY_BYTES, photoScanSchema } from "@/lib/ai-validation";
import { validPhotoBytes } from "@/lib/food-photo-bytes";
import { analyzeFoodPhoto } from "@/lib/food-vision";
import { beginScan, completeScan, failScan } from "@/lib/scan-accounting";

export const runtime = "nodejs";
export const maxDuration = 90;

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return aiFail("aiLoginRequired", 401);
    if (!process.env.OPENAI_API_KEY) return aiFail("aiUnavailable", 503);
    const input = photoScanSchema.parse(JSON.parse(await limitedBody(req, MAX_SCAN_BODY_BYTES)));
    if (!validPhotoBytes(input.image)) return aiFail("aiInvalidPhoto");
    const hash = createHash("sha256").update(input.image).update(input.locale).digest("hex");
    const token = randomUUID();
    const start = await beginScan(user.id, input.requestId, hash, token);
    if (start.status === "succeeded") return privateJson({ id: input.requestId, result: start.result, credits: start.credits, saved: start.saved });
    if (start.status === "no_credits") return aiFail("aiNoCredits", 402);
    if (start.status === "busy") return aiFail("aiScanBusy", 409);
    if (start.status === "rate_limited") return aiFail("aiRateLimited", 429);
    if (start.status !== "started") return aiFail("aiRetryScan", 409);
    try {
      const result = await analyzeFoodPhoto(input.image, input.locale);
      const completed = await completeScan(user.id, input.requestId, token, result);
      if (completed.status === "no_credits") throw new AiError("aiNoCredits", 402);
      if (completed.status !== "succeeded") throw new AiError("aiRetryScan", 409);
      return privateJson({ id: input.requestId, result: completed.result, credits: completed.credits, saved: completed.saved });
    } catch (error) {
      // A serverless interruption also self-recovers: the two-minute lease expires.
      try { await failScan(user.id, input.requestId, token); }
      catch { console.error("KALO scan lease cleanup failed"); }
      throw error;
    }
  } catch (error) { return aiHandleError(error); }
}
