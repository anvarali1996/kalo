import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

export const hasDatabase = () => Boolean(process.env.DATABASE_URL);

export function database() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not configured");
  return drizzle(process.env.DATABASE_URL, { schema });
}
