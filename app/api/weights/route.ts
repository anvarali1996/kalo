import { NextRequest, NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { database } from "@/db";
import { profiles, weightEntries } from "@/db/schema";
import { currentUser } from "@/lib/server-auth";
import { weightSchema } from "@/lib/validations";
import { checkOrigin, fail, handleError } from "@/lib/http";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const blocked = checkOrigin(req); if (blocked) return blocked;
  try {
    const user = await currentUser();
    if (!user) return fail("Sign in required", 401);
    const input = weightSchema.parse(await req.json());
    const db = database();
    const [item] = await db.insert(weightEntries).values({ ...input, userId: user.id })
      .onConflictDoUpdate({ target: [weightEntries.userId, weightEntries.date], set: { kg: input.kg } })
      .returning({ id: weightEntries.id, date: weightEntries.date, kg: weightEntries.kg });
    // A new measurement updates the plan only when it is not older than the latest weigh-in.
    const latest = await db.select({ date: weightEntries.date }).from(weightEntries)
      .where(eq(weightEntries.userId, user.id)).orderBy(desc(weightEntries.date)).limit(1);
    if (latest[0]?.date === input.date) {
      await db.update(profiles).set({ weightKg: input.kg, updatedAt: new Date() })
        .where(eq(profiles.userId, user.id));
    }
    return NextResponse.json({ item });
  } catch (e) { return handleError(e); }
}
