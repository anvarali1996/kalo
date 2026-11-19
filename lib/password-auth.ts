import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { eq, sql } from "drizzle-orm";
import { ZodError } from "zod";
import { database } from "@/db";
import { users } from "@/db/schema";
import { AiError, limitedBody, privateJson } from "./ai-http";
import { appName } from "./brand";
import { passwordTranslations } from "./password-i18n";
import { COOKIE_NAME, cookieOptions, hashToken } from "./server-auth";
import type { Locale } from "./types";

export const readPasswordBody = async (req: Request) => JSON.parse(await limitedBody(req, 2048));

export function passwordError(error: unknown) {
  if (error instanceof AiError || error instanceof ZodError || error instanceof SyntaxError) {
    return privateJson({ error: "formError" }, error instanceof AiError ? error.status : 400);
  }
  console.error("Kalo Balance password operation failed", error instanceof Error ? error.name : "UnknownError");
  return privateJson({ error: "passwordServiceUnavailable" }, 503);
}

export function passwordUpdated() {
  const response = privateJson({ ok: true });
  response.cookies.set(COOKIE_NAME, "", { ...cookieOptions, maxAge: 0 });
  return response;
}

// Vercel sets this header at its edge. Do not rate-limit on arbitrary client headers.
export function passwordRequestKey(req: Request) {
  const address = process.env.VERCEL === "1" ? req.headers.get("x-vercel-forwarded-for")?.split(",")[0].trim() : null;
  return address && isIP(address) ? address.toLowerCase() : "unavailable";
}

export async function allowPasswordAttempt(bucket: string, key: string, limit: number, seconds: number) {
  const { rows } = await database().execute<{ allowed: boolean }>(sql`select
    kalo_auth_attempt(${bucket}, ${hashToken(key)}, ${limit}, ${seconds}) as allowed`);
  return rows[0].allowed;
}

export async function sendPasswordReset(email: string, locale: Locale, origin: string, apiKey: string, from: string) {
  const db = database();
  const [user] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (!user) return;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const { rows } = await db.execute<{ issued: boolean }>(sql`select kalo_issue_password_reset(${user.id}::uuid, ${tokenHash}) as issued`);
  if (!rows[0].issued) return;

  const t = passwordTranslations[locale];
  const link = new URL("/reset-password", origin);
  // The token stays in the fragment until the browser sends it in a POST body.
  link.hash = new URLSearchParams({ token, lang: locale }).toString();
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json",
      "Idempotency-Key": `kalo-password-reset/${tokenHash}` },
    signal: AbortSignal.timeout(10_000),
    body: JSON.stringify({ from, to: [email], subject: `${appName} · ${t.passwordResetTitle}`,
      text: [t.passwordEmailBody, link.href, t.passwordResetHelp, t.passwordEmailIgnore].join("\n\n") }),
  });
  if (!response.ok) console.warn("Kalo Balance reset email was rejected by Resend", response.status);
}
