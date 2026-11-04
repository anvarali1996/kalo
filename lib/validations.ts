import { z } from "zod";

export const profileSchema = z.object({
  age: z.number().int().min(18).max(100),
  sex: z.enum(["female", "male"]),
  heightCm: z.number().min(100).max(240),
  weightKg: z.number().min(30).max(400),
  goalWeightKg: z.number().min(30).max(400),
  activity: z.enum(["sedentary", "light", "moderate", "active", "very"]),
  weeklyGoalKg: z.number().min(0.1).max(0.75),
}).refine(p => p.goalWeightKg <= p.weightKg, { message: "Goal cannot exceed current weight" });

export const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(s => {
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s);
});
export const diarySchema = z.object({
  date: dateSchema,
  name: z.string().trim().min(1).max(180),
  barcode: z.string().regex(/^\d{6,14}$/).nullable(),
  grams: z.number().positive().max(10000),
  kcal: z.number().min(0).max(25000),
  protein: z.number().min(0).max(10000).nullable(),
  carbs: z.number().min(0).max(10000).nullable(),
  fat: z.number().min(0).max(10000).nullable(),
  image: z.string().url().max(2000).nullable(),
  source: z.enum(["off", "manual"]),
});
export const weightSchema = z.object({ date: dateSchema, kg: z.number().min(30).max(400) });
export const credentialsSchema = z.object({
  email: z.email().max(254).transform(e => e.toLowerCase().trim()),
  password: z.string().min(8).max(72),
});
export const registerSchema = credentialsSchema.extend({ name: z.string().trim().min(2).max(100) });
