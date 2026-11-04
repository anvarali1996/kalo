import { NextRequest, NextResponse } from "next/server";
import { database } from "@/db";
import { diaryEntries } from "@/db/schema";
import { currentUser } from "@/lib/server-auth";
import { diarySchema } from "@/lib/validations";
import { checkOrigin, fail, handleError } from "@/lib/http";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return fail("Sign in required", 401);
    const input = diarySchema.parse(await req.json());
    const [item] = await database().insert(diaryEntries).values({ userId: user.id, ...input }).returning();
    const { userId: _userId, createdAt: _createdAt, ...entry } = item;
    return NextResponse.json({ entry }, { status: 201 });
  } catch (e) { return handleError(e); }
}
