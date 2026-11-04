import { describe, expect, it } from "vitest";
import { calculatePlan, localDate, scale, sumDiary } from "../lib/calories";
import { defaultProfile } from "../lib/types";

describe("Adult calorie estimates", () => {
  it("calculates Mifflin-St Jeor BMR correctly", () => {
    const plan = calculatePlan({ ...defaultProfile, sex: "female", age: 30, weightKg: 70, heightCm: 165 });
    // 700 + 1031.25 - 150 - 161 = 1420.25
    expect(plan.bmr).toBe(1420);
  });
  it("keeps the energy estimate above the conservative planning floor", () => {
    const plan = calculatePlan({ ...defaultProfile, sex: "female", weightKg: 47,
      heightCm: 150, goalWeightKg: 35, weeklyGoalKg: 0.75, activity: "sedentary" });
    expect(plan.suggestedCalories).toBeGreaterThanOrEqual(1200);
    expect(plan.floorApplied).toBe(true);
  });
  it("does not prescribe loss when already at or below goal", () => {
    const plan = calculatePlan({ ...defaultProfile, weightKg: 65, goalWeightKg: 65 });
    expect(plan.deficit).toBe(0);
    expect(plan.weeks).toBeNull();
  });
  it("estimates required deficit and time to goal", () => {
    const plan = calculatePlan(defaultProfile);
    expect(plan.maintenance).toBeGreaterThan(plan.bmr);
    expect(plan.deficit).toBeGreaterThan(0);
    expect(plan.weeks).toBeGreaterThan(0);
  });
});

describe("Food diary math", () => {
  it("scales nutrition per 100 grams", () => {
    expect(scale(250, 80)).toBe(200);
    expect(scale(null, 80)).toBeNull();
  });
  it("sums diary values, preserving absent macros as zero only in totals", () => {
    const entries = [{ id: "1", date: "2026-11-04", name: "Test", barcode: null, grams: 100,
      kcal: 120.3, protein: null, carbs: 15.2, fat: 4.3, image: null, source: "manual" as const }];
    expect(sumDiary(entries)).toEqual({ kcal: 120, protein: 0, carbs: 15.2, fat: 4.3 });
  });
  it("formats local dates without UTC shifts", () => {
    expect(localDate(new Date(2026, 10, 4))).toBe("2026-11-04");
  });
});
