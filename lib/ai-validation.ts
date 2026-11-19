import { z } from "zod";
import { dateSchema } from "./validations";
import { billingProducts } from "./pricing";

export const MAX_PHOTO_BYTES = 2_500_000;
export const MAX_SCAN_BODY_BYTES = 3_500_000;
export const localeSchema = z.enum(["uz", "en", "ru", "lv"]);
export const requestIdSchema = z.uuid();

export const foodPhotoResultSchema = z.object({
  containsFood: z.boolean(),
  foods: z.array(z.object({
    name: z.string().trim().min(1).max(180),
    portionGrams: z.number().min(1).max(5000),
    kcal: z.number().min(0).max(10000),
    protein: z.number().min(0).max(2000),
    carbs: z.number().min(0).max(2000),
    fat: z.number().min(0).max(2000),
  }).strict()).max(12),
  notes: z.string().max(1000),
}).strict();

export const photoScanSchema = z.object({
  requestId: requestIdSchema,
  locale: localeSchema,
  image: z.string().max(Math.ceil(MAX_PHOTO_BYTES / 3) * 4 + 32)
    .regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/),
}).strict();

export const checkoutSchema = z.object({ requestId: requestIdSchema, locale: localeSchema, product: z.enum(billingProducts) }).strict();
export const savePhotoScanSchema = z.object({
  date: dateSchema,
  portions: z.array(z.number().min(1).max(5000)).min(1).max(12),
}).strict();
