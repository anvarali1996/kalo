import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

export async function migrateTestDatabase(db: PGlite) {
  const baseline = await readFile(new URL("../drizzle/0000_existing_schema.sql", import.meta.url), "utf8");
  const features = await readFile(new URL("../drizzle/0001_ai_scans_and_payments.sql", import.meta.url), "utf8");
  await db.exec(`BEGIN; ${baseline} COMMIT;`);
  await db.exec(`BEGIN; ${features} COMMIT;`);
}

export async function createTestUser(db: PGlite) {
  const id = randomUUID();
  await db.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, 'Test User', $2, 'test-hash')", [id, `${id}@example.test`]);
  return id;
}

export const estimate = { containsFood: true, foods: [
  { name: "Rice", portionGrams: 200, kcal: 260, protein: 5.4, carbs: 56, fat: 0.6 },
  { name: "Chicken", portionGrams: 100, kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
], notes: "Portions and preparation are estimated." };
