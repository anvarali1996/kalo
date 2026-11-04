import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt } from "drizzle-orm";
import { database, hasDatabase } from "@/db";
import { sessions, users } from "@/db/schema";
import type { SessionUser } from "@/lib/types";

export const COOKIE_NAME = "kalo_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 30;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  await database().insert(sessions).values({ userId, tokenHash: hashToken(token), expiresAt });
  return token;
}

export const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const, path: "/", maxAge: SESSION_SECONDS,
};

export async function currentUser(): Promise<SessionUser | null> {
  if (!hasDatabase()) return null;
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const rows = await database().select({ id: users.id, name: users.name, email: users.email })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, hashToken(token)), gt(sessions.expiresAt, new Date()))).limit(1);
  return rows[0] || null;
}

export async function invalidateSession() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (token && hasDatabase()) {
    await database().delete(sessions).where(eq(sessions.tokenHash, hashToken(token)));
  }
}
