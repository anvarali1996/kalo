import { pgTable, uuid, varchar, text, timestamp, real, smallint, jsonb, uniqueIndex, index } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 100 }).notNull(),
  email: varchar("email", { length: 254 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 64 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("sessions_user_idx").on(t.userId)]);

export const profiles = pgTable("profiles", {
  userId: uuid("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  sex: varchar("sex", { length: 10 }).notNull(),
  age: smallint("age").notNull(),
  heightCm: real("height_cm").notNull(),
  weightKg: real("weight_kg").notNull(),
  goalWeightKg: real("goal_weight_kg").notNull(),
  activity: varchar("activity", { length: 20 }).notNull(),
  weeklyGoalKg: real("weekly_goal_kg").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

export const diaryEntries = pgTable("diary_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: varchar("date", { length: 10 }).notNull(),
  name: varchar("name", { length: 180 }).notNull(),
  barcode: varchar("barcode", { length: 20 }),
  grams: real("grams").notNull(),
  kcal: real("kcal").notNull(),
  protein: real("protein"),
  carbs: real("carbs"),
  fat: real("fat"),
  image: text("image"),
  source: varchar("source", { length: 10 }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [index("diary_user_date_idx").on(t.userId, t.date)]);

export const weightEntries = pgTable("weight_entries", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: varchar("date", { length: 10 }).notNull(),
  kg: real("kg").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => [uniqueIndex("weight_user_date_uidx").on(t.userId, t.date)]);

export type ProductSnapshot = {
  barcode: string; name: string; brand: string; image: string | null;
  kcal100: number | null; protein100: number | null; carbs100: number | null; fat100: number | null;
  sugar100: number | null; salt100: number | null; fiber100: number | null;
  nutriscore: string | null; nova: number | null; ingredients: string | null;
  allergens: string[]; serving: string | null; quantity: string | null;
};

export const productCache = pgTable("product_cache", {
  barcode: varchar("barcode", { length: 20 }).primaryKey(),
  payload: jsonb("payload").$type<ProductSnapshot>().notNull(),
  cachedAt: timestamp("cached_at", { withTimezone: true }).defaultNow().notNull(),
});
