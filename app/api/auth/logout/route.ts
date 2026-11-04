import { NextRequest, NextResponse } from "next/server";
import { invalidateSession, COOKIE_NAME } from "@/lib/server-auth";
import { checkOrigin, handleError } from "@/lib/http";
export const runtime = "nodejs";
export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  try {
    await invalidateSession();
    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
    return res;
  } catch (e) { return handleError(e); }
}
