import type { DiaryItem } from "./types";

export interface EstimatedFood {
  name: string;
  portionGrams: number;
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface FoodPhotoResult {
  containsFood: boolean;
  foods: EstimatedFood[];
  notes: string;
}

export interface ScanResponse {
  id: string;
  result: FoodPhotoResult;
  credits: number;
  saved: boolean;
}

export interface ScanPurchase {
  id: string;
  credits: number;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "expired" | "failed";
  createdAt: string;
  paidAt: string | null;
}

export interface CreditsResponse {
  credits: number;
  purchases: ScanPurchase[];
  hasMore: boolean;
  scanningAvailable: boolean;
  checkoutAvailable: boolean;
}

export type ScanDiaryResponse = { entries: DiaryItem[] };

/** Nutrition values are for the estimated portion, not per 100 grams. */
export function scaleEstimatedFood(food: EstimatedFood, grams: number) {
  const ratio = grams / food.portionGrams;
  const round = (n: number) => Math.round(n * 10) / 10;
  return {
    kcal: round(food.kcal * ratio), protein: round(food.protein * ratio),
    carbs: round(food.carbs * ratio), fat: round(food.fat * ratio),
  };
}
