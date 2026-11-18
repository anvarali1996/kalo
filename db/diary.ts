import { pgTable } from "drizzle-orm/pg-core";
import { diaryEntryColumns } from "./schema";

// Account loading and standard diary writes also work before AI scanning is enabled.
export const standardDiaryEntries = pgTable("diary_entries", diaryEntryColumns());
