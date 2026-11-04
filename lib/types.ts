export type Locale = "uz" | "en" | "ru" | "lv";
export type Sex = "female" | "male";
export type Activity = "sedentary" | "light" | "moderate" | "active" | "very";
export type View = "dashboard" | "scanner" | "diary" | "profile";

export interface Profile {
  age: number; sex: Sex; heightCm: number; weightKg: number; goalWeightKg: number;
  activity: Activity; weeklyGoalKg: number;
}
export interface DiaryItem {
  id: string; date: string; name: string; barcode: string | null; grams: number;
  kcal: number; protein: number | null; carbs: number | null; fat: number | null;
  image: string | null; source: "off" | "manual";
}
export interface WeightItem { id: string; date: string; kg: number; }
export interface Product {
  barcode: string; name: string; brand: string; image: string | null;
  kcal100: number | null; protein100: number | null; carbs100: number | null; fat100: number | null;
  sugar100: number | null; salt100: number | null; fiber100: number | null;
  nutriscore: string | null; nova: number | null; ingredients: string | null;
  allergens: string[]; serving: string | null; quantity: string | null;
}
export interface SessionUser { id: string; name: string; email: string; }

export const defaultProfile: Profile = {
  sex: "female", age: 29, heightCm: 165, weightKg: 74,
  goalWeightKg: 66, activity: "light", weeklyGoalKg: 0.4,
};
