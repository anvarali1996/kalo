import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { database, hasDatabase } from "@/db";
import { productCache, type ProductSnapshot } from "@/db/schema";
import { fail, handleError } from "@/lib/http";
export const runtime = "nodejs";

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) / 100 : null;

function normalize(barcode: string, p: Record<string, unknown>): ProductSnapshot {
  const n = (p.nutriments || {}) as Record<string, unknown>;
  const kcal = num(n["energy-kcal_100g"]) ?? (num(n.energy_100g) === null ? null : Math.round((num(n.energy_100g)! / 4.184) * 10) / 10);
  const text = (v: unknown): string | null => typeof v === "string" && v.trim() ? v.trim() : null;
  const safeImage = (v: unknown) => {
    const src = text(v);
    if (!src) return null;
    try { const url = new URL(src); return url.protocol === "https:" && /(^|\.)openfoodfacts\.org$/.test(url.hostname) ? src : null; }
    catch { return null; }
  };
  return {
    barcode, name: text(p.product_name) || text(p.product_name_en) || "Unknown product",
    brand: text(p.brands) || "", image: safeImage(p.image_front_small_url) || safeImage(p.image_url),
    kcal100: kcal, protein100: num(n.proteins_100g), carbs100: num(n.carbohydrates_100g),
    fat100: num(n.fat_100g), sugar100: num(n.sugars_100g), salt100: num(n.salt_100g), fiber100: num(n.fiber_100g),
    nutriscore: text(p.nutriscore_grade) || text(p.nutrition_grades),
    nova: num(p.nova_group), ingredients: text(p.ingredients_text),
    allergens: Array.isArray(p.allergens_tags) ? p.allergens_tags.filter((v): v is string => typeof v === "string").slice(0, 12) : [],
    serving: text(p.serving_size), quantity: text(p.quantity),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ barcode: string }> }) {
  const { barcode } = await params;
  if (!/^\d{6,14}$/.test(barcode)) return fail("Barcode must be 6–14 digits.", 400);
  if (process.env.NODE_ENV === "production" && !process.env.OFF_CONTACT_EMAIL) {
    return fail("Set OFF_CONTACT_EMAIL before using Open Food Facts in production.", 503);
  }
  let stale: ProductSnapshot | null = null;
  try {
    if (hasDatabase()) {
      const [row] = await database().select().from(productCache).where(eq(productCache.barcode, barcode)).limit(1);
      if (row) {
        stale = row.payload;
        if (Date.now() - row.cachedAt.getTime() < 7 * 86400000) return NextResponse.json({ product: row.payload, cached: true });
      }
    }
    const url = new URL(`https://world.openfoodfacts.org/api/v3/product/${barcode}.json`);
    url.searchParams.set("fields", "code,product_name,product_name_en,brands,nutriments,image_front_small_url,image_url,nutriscore_grade,nutrition_grades,nova_group,ingredients_text,allergens_tags,serving_size,quantity");
    const upstream = await fetch(url, {
      headers: { "User-Agent": `KALO/1.0 (${process.env.OFF_CONTACT_EMAIL || "configure-OFF_CONTACT_EMAIL@example.invalid"})`, "Accept": "application/json" },
      signal: AbortSignal.timeout(10000),
      next: { revalidate: 86400 },
    });
    if (upstream.status === 404) return fail("Product not found in Open Food Facts.", 404);
    if (!upstream.ok) {
      if (stale) return NextResponse.json({ product: stale, cached: true, stale: true });
      return fail("Open Food Facts is temporarily unavailable.", 503);
    }
    const payload = await upstream.json() as { product?: Record<string, unknown>; result?: { id?: string } };
    if (!payload.product || payload.result?.id === "product_not_found") return fail("Product not found in Open Food Facts.", 404);
    const product = normalize(barcode, payload.product);
    if (hasDatabase()) await database().insert(productCache).values({ barcode, payload: product })
      .onConflictDoUpdate({ target: productCache.barcode, set: { payload: product, cachedAt: new Date() } });
    return NextResponse.json({ product, cached: false });
  } catch (e) {
    if (stale) return NextResponse.json({ product: stale, cached: true, stale: true });
    return handleError(e);
  }
}
