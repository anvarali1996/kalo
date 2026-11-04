import { NextRequest, NextResponse } from "next/server";
import { database } from "@/db";
import { profiles } from "@/db/schema";
import { currentUser } from "@/lib/server-auth";
import { profileSchema } from "@/lib/validations";
import { checkOrigin, fail, handleError } from "@/lib/http";
export const runtime = "nodejs";

export async function PUT(req: NextRequest) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return fail("Sign in required", 401);
    const input = profileSchema.parse(await req.json());
    await database().insert(profiles).values({ userId: user.id, ...input })
      .onConflictDoUpdate({ target: profiles.userId, set: { ...input, updatedAt: new Date() } });
    return NextResponse.json({ profile: input });
  } catch (e) { return handleError(e); }
}
