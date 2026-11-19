import { after, type NextRequest } from "next/server";
import { z } from "zod";
import { hasDatabase } from "@/db";
import { privateJson } from "@/lib/ai-http";
import { localeSchema } from "@/lib/ai-validation";
import { checkOrigin, publicAppOrigin } from "@/lib/http";
import { allowPasswordAttempt, passwordError, passwordRequestKey, readPasswordBody, sendPasswordReset } from "@/lib/password-auth";
import { credentialsSchema } from "@/lib/validations";

export const runtime = "nodejs";
export const maxDuration = 30;
const schema = z.object({ email: z.string().trim().pipe(credentialsSchema.shape.email), locale: localeSchema }).strict();

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  try {
    const { email, locale } = schema.parse(await readPasswordBody(req));
    const origin = publicAppOrigin();
    const apiKey = process.env.RESEND_API_KEY?.trim();
    const from = process.env.RESEND_FROM_EMAIL?.trim();
    if (!hasDatabase() || !origin || !apiKey || !from) {
      return privateJson({ error: "passwordServiceUnavailable" }, 503);
    }
    // Rate-limit addresses and inboxes before looking up any account. All valid
    // requests receive the same acknowledgment, including throttled requests.
    if (await allowPasswordAttempt("forgot-ip", passwordRequestKey(req), 12, 3600) &&
        await allowPasswordAttempt("forgot-email", email, 3, 3600)) {
      after(async () => {
        try { await sendPasswordReset(email, locale, origin, apiKey, from); }
        catch { console.warn("Kalo Balance reset email could not be queued"); }
      });
    }
    return privateJson({ ok: true }, 202);
  } catch (error) { return passwordError(error); }
}
