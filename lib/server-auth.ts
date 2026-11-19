import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { and, desc, eq, exists, gt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { database, hasDatabase } from "@/db";
import { sessions, users } from "@/db/schema";
import type { SessionUser } from "@/lib/types";
import { isAdminUser } from "@/lib/admin-access";

export const COOKIE_NAME = "kalo_session";
export const SESSION_SECONDS = 60 * 60 * 24 * 30;
export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function createSession(userId: string, passwordHash: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_SECONDS * 1000);
  const db = database();
  // Neon runs the batch in one transaction. Lock the account before reading or
  // replacing its sessions so simultaneous sign-ins cannot leave two active tokens.
  const passwordUnchanged = and(eq(users.id, userId), eq(users.passwordHash, passwordHash));
  const [, , inserted] = await db.batch([
    db.select({ id: users.id }).from(users).where(eq(users.id, userId)).for("update"),
    db.delete(sessions).where(and(eq(sessions.userId, userId),
      exists(db.select({ id: users.id }).from(users).where(passwordUnchanged)))),
    db.execute<{ id: string }>(sql`insert into sessions (user_id, token_hash, expires_at)
      select ${users.id}, ${hashToken(token)}, ${expiresAt.toISOString()}::timestamptz
      from ${users} where ${passwordUnchanged} returning id`),
  ]);
  return inserted.rows.length ? token : null;
}

export function publicSessionUser({ id, name, email }: SessionUser): SessionUser {
  return { id, name, email, isAdmin: isAdminUser(id) };
}

export const cookieOptions = {
  httpOnly: true, secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const, path: "/", maxAge: SESSION_SECONDS,
};

export async function currentSessionHash() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  return token ? hashToken(token) : null;
}

export async function currentUser(): Promise<SessionUser | null> {
  if (!hasDatabase()) return null;
  const token = await currentSessionHash();
  if (!token) return null;
  const db = database();
  const latest = alias(sessions, "latest_session");
  const latestSessionId = db.select({ id: latest.id }).from(latest)
    .where(eq(latest.userId, sessions.userId)).orderBy(desc(latest.createdAt), desc(latest.id)).limit(1);
  const [user] = await db.select({ id: users.id, name: users.name, email: users.email })
    .from(sessions).innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.tokenHash, token), gt(sessions.expiresAt, new Date()),
      eq(sessions.id, latestSessionId))).limit(1);
  return user ? publicSessionUser(user) : null;
}

export async function invalidateSession() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token || !hasDatabase()) return;
  const db = database();
  const matching = alias(sessions, "logout_session");
  // Remove older sessions too, so logging out cannot make a pre-update token valid.
  await db.delete(sessions).where(exists(
    db.select({ id: matching.id }).from(matching).where(and(
      eq(matching.tokenHash, hashToken(token)),
      eq(matching.userId, sessions.userId),
      sql`(${sessions.createdAt}, ${sessions.id}) <= (${matching.createdAt}, ${matching.id})`,
    )),
  ));
}
