import type { Activity, DiaryItem, Profile } from "./types";

const activityFactors: Record<Activity, number> = {
  sedentary: 1.2, light: 1.375, moderate: 1.55, active: 1.725, very: 1.9,
};

/** Adult estimates only. Not suitable for pregnancy, minors or clinical diet planning. */
export function calculatePlan(p: Profile) {
  const bmr = 10 * p.weightKg + 6.25 * p.heightCm - 5 * p.age + (p.sex === "male" ? 5 : -161);
  const maintenance = Math.round(bmr * activityFactors[p.activity]);
  const deficitRequested = p.goalWeightKg < p.weightKg ? (p.weeklyGoalKg * 7700) / 7 : 0;
  // Approximate safety floors for general adult education, not personalized medical advice.
  const minimum = p.sex === "male" ? 1500 : 1200;
  const suggestedCalories = Math.round(Math.max(minimum, maintenance - deficitRequested));
  const deficit = Math.max(0, maintenance - suggestedCalories);
  const weeks = p.goalWeightKg < p.weightKg && deficit > 0
    ? Math.ceil(((p.weightKg - p.goalWeightKg) * 7700) / (deficit * 7)) : null;
  return {
    bmr: Math.round(bmr), maintenance, suggestedCalories, deficit: Math.round(deficit),
    projectedWeeklyKg: Math.round((deficit * 7 / 7700) * 100) / 100,
    remainingKg: Math.max(0, Math.round((p.weightKg - p.goalWeightKg) * 10) / 10),
    weeks, bmi: Math.round((p.weightKg / (p.heightCm / 100) ** 2) * 10) / 10,
    floorApplied: deficitRequested > 0 && maintenance - deficitRequested < minimum,
  };
}

export const sumDiary = (entries: DiaryItem[]) => ({
  kcal: Math.round(entries.reduce((s, e) => s + e.kcal, 0)),
  protein: Math.round(entries.reduce((s, e) => s + (e.protein ?? 0), 0) * 10) / 10,
  carbs: Math.round(entries.reduce((s, e) => s + (e.carbs ?? 0), 0) * 10) / 10,
  fat: Math.round(entries.reduce((s, e) => s + (e.fat ?? 0), 0) * 10) / 10,
});

export const scale = (value: number | null, grams: number): number | null =>
  value === null ? null : Math.round(value * grams) / 100;

// Uses the browser's local date rather than UTC, so late-night entries don't slip a day.
export function localDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
