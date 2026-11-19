import { PGlite } from "@electric-sql/pglite";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

export async function migrateTestDatabase(db: PGlite, from = 0, to?: number) {
  const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle/", import.meta.url)) });
  for (const migration of migrations.slice(from, to)) {
    await db.transaction(async tx => {
      for (const statement of migration.sql.map(s => s.trim()).filter(Boolean)) await tx.exec(statement);
    });
  }
}

type PreparedSql = { sql: string; params: unknown[] };
type BatchQuery = { toSQL?: () => PreparedSql; getQuery?: () => PreparedSql };

// Neon executes these statements in one transaction. Run the same generated
// SQL and return the database rows when exercising the routes in PGlite.
export const testBatch = (pg: PGlite) => async (queries: BatchQuery[]) => pg.transaction(async tx => {
  const results = [];
  for (const query of queries) {
    const statement = query.toSQL?.() ?? query.getQuery?.();
    if (!statement) throw new Error("Cannot compile test query");
    results.push(await tx.query(statement.sql, statement.params));
  }
  return results;
});

export async function createTestUser(db: PGlite) {
  const id = randomUUID();
  await db.query("INSERT INTO users (id, name, email, password_hash) VALUES ($1, 'Test User', $2, 'test-hash')", [id, `${id}@example.test`]);
  return id;
}

export const estimate = { containsFood: true, foods: [
  { name: "Rice", portionGrams: 200, kcal: 260, protein: 5.4, carbs: 56, fat: 0.6 },
  { name: "Chicken", portionGrams: 100, kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
], notes: "Portions and preparation are estimated." };
