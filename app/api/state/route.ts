import { NextResponse } from "next/server";
import { desc, eq } from "drizzle-orm";
import { database } from "@/db";
import { diaryEntries, profiles, weightEntries } from "@/db/schema";
import { currentUser } from "@/lib/server-auth";
import { fail, handleError } from "@/lib/http";
export const runtime = "nodejs";

export async function GET() {
  try {
    const user = await currentUser();
    if (!user) return fail("Sign in required", 401);
    const db = database();
    const [profileRows, entries, weights] = await Promise.all([
      db.select().from(profiles).where(eq(profiles.userId, user.id)).limit(1),
      db.select().from(diaryEntries).where(eq(diaryEntries.userId, user.id)).orderBy(desc(diaryEntries.date), desc(diaryEntries.createdAt)).limit(1500),
      db.select().from(weightEntries).where(eq(weightEntries.userId, user.id)).orderBy(desc(weightEntries.date)).limit(500),
    ]);
    const p = profileRows[0];
    return NextResponse.json({
      profile: p ? { sex: p.sex, age: p.age, heightCm: p.heightCm, weightKg: p.weightKg,
        goalWeightKg: p.goalWeightKg, activity: p.activity, weeklyGoalKg: p.weeklyGoalKg } : null,
      diary: entries.map(({ userId: _userId, createdAt: _createdAt, ...rest }) => rest),
      weights: weights.map(({ userId: _userId, createdAt: _createdAt, ...rest }) => rest),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) { return handleError(e); }
}
