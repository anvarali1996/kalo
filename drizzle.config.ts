import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

// Drizzle CLI does not automatically load Next.js's .env.local.
config({ path: ".env.local" });
config({ path: ".env" });

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL missing. Copy .env.example to .env.local and paste your Neon connection string.");
}

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: { url: process.env.DATABASE_URL },
});
