import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { database, hasDatabase } from "@/db";
import { users } from "@/db/schema";
import { createSession, COOKIE_NAME, cookieOptions } from "@/lib/server-auth";
import { registerSchema } from "@/lib/validations";
import { checkOrigin, fail, handleError } from "@/lib/http";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  if (!hasDatabase()) return fail("Connect Neon DATABASE_URL to create an account.", 503);
  try {
    const input = registerSchema.parse(await req.json());
    const db = database();
    if ((await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1)).length) {
      return fail("Email already registered.", 409);
    }
    const passwordHash = await bcrypt.hash(input.password, 12);
    const [user] = await db.insert(users).values({ name: input.name, email: input.email, passwordHash })
      .onConflictDoNothing().returning({ id: users.id, name: users.name, email: users.email });
    if (!user) return fail("Email already registered.", 409);
    const token = await createSession(user.id);
    const response = NextResponse.json({ user }, { status: 201 });
    response.cookies.set(COOKIE_NAME, token, cookieOptions);
    return response;
  } catch (e) { return handleError(e); }
}
