import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
export function handleError(error: unknown) {
  if (error instanceof ZodError) return fail(error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
  console.error("KALO API error", error instanceof Error ? error.name : "UnknownError");
  return fail("Server error. Please try again.", 500);
}

/** Reject browser cross-site writes when a cookie-authenticated route is used. */
export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return fail("Cross-origin request blocked.", 403);
  return null;
}

export function publicAppOrigin() {
  try {
    const url = new URL(process.env.APP_URL || (process.env.NODE_ENV === "production" ? "" : "http://localhost:3000"));
    if (url.username || url.password || url.pathname !== "/" || url.search || url.hash ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)))) {
      return null;
    }
    return url.origin;
  } catch { return null; }
}
