import { NextRequest, NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { database } from "@/db";
import { diaryEntries } from "@/db/schema";
import { currentUser } from "@/lib/server-auth";
import { checkOrigin, fail, handleError } from "@/lib/http";
export const runtime = "nodejs";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return fail("Sign in required", 401);
    const { id } = await params;
    if (!/^[a-f0-9-]{36}$/i.test(id)) return fail("Invalid entry ID");
    const [deleted] = await database().delete(diaryEntries)
      .where(and(eq(diaryEntries.id, id), eq(diaryEntries.userId, user.id)))
      .returning({ id: diaryEntries.id });
    if (!deleted) return fail("Entry not found", 404);
    return NextResponse.json({ ok: true });
  } catch (e) { return handleError(e); }
}
