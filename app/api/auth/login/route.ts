import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { database, hasDatabase } from "@/db";
import { users } from "@/db/schema";
import { createSession, COOKIE_NAME, cookieOptions } from "@/lib/server-auth";
import { credentialsSchema } from "@/lib/validations";
import { checkOrigin, fail, handleError } from "@/lib/http";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  if (!hasDatabase()) return fail("Connect Neon DATABASE_URL to sign in.", 503);
  try {
    const input = credentialsSchema.parse(await req.json());
    const [user] = await database().select().from(users).where(eq(users.email, input.email)).limit(1);
    if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) return fail("Invalid email or password.", 401);
    const token = await createSession(user.id);
    const response = NextResponse.json({ user: { id: user.id, name: user.name, email: user.email } });
    response.cookies.set(COOKIE_NAME, token, cookieOptions);
    return response;
  } catch (e) { return handleError(e); }
}
