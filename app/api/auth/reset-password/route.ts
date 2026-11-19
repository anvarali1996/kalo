import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { database } from "@/db";
import { passwordResetTokens } from "@/db/schema";
import { privateJson } from "@/lib/ai-http";
import { checkOrigin } from "@/lib/http";
import { allowPasswordAttempt, passwordError, passwordRequestKey, passwordUpdated, readPasswordBody } from "@/lib/password-auth";
import { hashToken } from "@/lib/server-auth";
import { redeemPasswordSchema } from "@/lib/validations";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  try {
    const { token, password } = redeemPasswordSchema.parse(await readPasswordBody(req));
    if (!(await allowPasswordAttempt("reset-ip", passwordRequestKey(req), 20, 900))) {
      return privateJson({ error: "passwordRateLimited" }, 429);
    }
    const tokenHash = hashToken(token);
    const db = database();
    const [reset] = await db.select({ userId: passwordResetTokens.userId }).from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash), gt(passwordResetTokens.expiresAt, sql`now()`))).limit(1);
    if (!reset) return privateJson({ error: "passwordResetTokenInvalid" }, 400);
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await db.execute<{ updated: boolean }>(sql`select
      kalo_redeem_password_reset(${tokenHash}, ${passwordHash}) as updated`);
    return rows[0].updated ? passwordUpdated() : privateJson({ error: "passwordResetTokenInvalid" }, 400);
  } catch (error) { return passwordError(error); }
}
