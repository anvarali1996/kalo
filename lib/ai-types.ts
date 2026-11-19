import type { DiaryItem } from "./types";
import type { BillingProduct } from "./pricing";

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
  kind: "pack" | "pro";
  credits: number;
  amount: number;
  currency: string;
  status: "pending" | "paid" | "expired" | "failed" | "refunded";
  refundedAmount: number;
  createdAt: string;
  paidAt: string | null;
}

export interface ScanAllowance {
  credits: number;
  plan: "basic" | "pro";
  monthlyCredits: number;
  purchasedCredits: number;
  monthlyExpiresAt: string;
  renewalAt: string | null;
  cancelAt: string | null;
  subscriptionStatus: string | null;
  canSubscribe: boolean;
  proCheckoutId: string | null;
}

export interface CreditsResponse extends ScanAllowance {
  purchases: ScanPurchase[];
  hasMore: boolean;
  scanningAvailable: boolean;
  availableProducts: BillingProduct[];
  portalAvailable: boolean;
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
