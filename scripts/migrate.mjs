import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";

config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
if (!process.env.DATABASE_URL) throw new Error("Set DATABASE_URL before running db:migrate.");

const sql = neon(process.env.DATABASE_URL);
await sql.query("CREATE SCHEMA IF NOT EXISTS drizzle");
await sql.query("CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text NOT NULL, created_at bigint)");
const applied = await sql.query("SELECT hash, created_at FROM drizzle.__drizzle_migrations ORDER BY created_at");
const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
for (const migration of migrations) {
  const previous = applied.find(row => Number(row.created_at) === migration.folderMillis);
  if (previous) {
    if (previous.hash !== migration.hash) throw new Error("An applied migration was modified. Restore it before continuing.");
    continue;
  }
  if (applied.some(row => Number(row.created_at) > migration.folderMillis)) throw new Error("Migration history is out of order.");
  // neon-http's stock Drizzle migrator executes individual statements without a
  // transaction. Use the Drizzle journal with one Neon transaction per migration,
  // including its ledger entry: a failed migration cannot partially apply.
  const statements = migration.sql.map(statement => statement.trim()).filter(Boolean);
  await sql.transaction([
    ...statements.map(statement => sql.query(statement)),
    sql.query('INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)', [migration.hash, migration.folderMillis]),
  ]);
  console.log(`Applied migration ${migration.folderMillis}`);
}
console.log("Database migrations are up to date.");
