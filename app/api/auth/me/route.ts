import { NextResponse } from "next/server";
import { currentUser } from "@/lib/server-auth";
import { hasDatabase } from "@/db";
import { handleError } from "@/lib/http";
export const runtime = "nodejs";
export async function GET() {
  try { return NextResponse.json({ user: await currentUser(), databaseConfigured: hasDatabase() }); }
  catch (e) { return handleError(e); }
}
