import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ZodError } from "zod";

export function fail(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}
export function handleError(error: unknown) {
  if (error instanceof ZodError) return fail(error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; "), 400);
  console.error("KALO API error", error);
  return fail("Server error. Please try again.", 500);
}

/** Reject browser cross-site writes when a cookie-authenticated route is used. */
export function checkOrigin(req: NextRequest) {
  const origin = req.headers.get("origin");
  if (origin && origin !== req.nextUrl.origin) return fail("Cross-origin request blocked.", 403);
  return null;
}
