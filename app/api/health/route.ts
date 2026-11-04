import { NextResponse } from "next/server";
import { hasDatabase } from "@/db";
export async function GET() {
  return NextResponse.json({ ok: true, databaseConfigured: hasDatabase(), version: "1.0.0" });
}
