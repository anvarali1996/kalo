export const billingProducts = ["pro", "pack20", "pack50"] as const;
export type BillingProduct = typeof billingProducts[number];

export const basicMonthlyScans = 6;
export const legacyProPricing = { scans: 100, cents: 999 } as const;
export const pricing = {
  pro: { scans: 120, cents: 799 },
  pack20: { scans: 20, cents: 299 },
  pack50: { scans: 50, cents: 599 },
} as const satisfies Record<BillingProduct, { scans: number; cents: number }>;
