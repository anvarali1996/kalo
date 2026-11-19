import type { NextRequest } from "next/server";
import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { database } from "@/db";
import { users } from "@/db/schema";
import { privateJson } from "@/lib/ai-http";
import { checkOrigin } from "@/lib/http";
import { allowPasswordAttempt, passwordError, passwordRequestKey, passwordUpdated, readPasswordBody } from "@/lib/password-auth";
import { currentSessionHash, currentUser } from "@/lib/server-auth";
import { changePasswordSchema } from "@/lib/validations";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req);
  if (blocked) return blocked;
  try {
    const user = await currentUser();
    const sessionHash = await currentSessionHash();
    if (!user || !sessionHash) return privateJson({ error: "sessionEnded" }, 401);
    const { currentPassword, password } = changePasswordSchema.parse(await readPasswordBody(req));
    if (!(await allowPasswordAttempt("change-ip", passwordRequestKey(req), 20, 900)) ||
        !(await allowPasswordAttempt("change-user", user.id, 5, 900))) {
      return privateJson({ error: "passwordRateLimited" }, 429);
    }
    const db = database();
    const [account] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
    if (!account || !(await bcrypt.compare(currentPassword, account.passwordHash))) {
      return privateJson({ error: "passwordCurrentInvalid" }, 400);
    }
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await db.execute<{ updated: boolean }>(sql`select kalo_change_password(
      ${user.id}::uuid, ${sessionHash}, ${account.passwordHash}, ${passwordHash}) as updated`);
    return rows[0].updated ? passwordUpdated() : privateJson({ error: "sessionEnded" }, 401);
  } catch (error) { return passwordError(error); }
}
