import { sql } from "drizzle-orm";
import type { database } from "@/db";

export async function isAiDatabaseReady(db: ReturnType<typeof database>) {
  const { rows } = await db.execute<{ ready: boolean }>(sql`
    select (
      to_regclass('public.scan_accounts') is not null
      and to_regclass('public.ai_scans') is not null
      and to_regclass('public.scan_purchases') is not null
      and to_regclass('public.scan_credit_transactions') is not null
      and to_regclass('public.stripe_webhook_events') is not null
      and to_regprocedure('public.kalo_begin_scan(uuid, uuid, text, uuid)') is not null
      and to_regprocedure('public.kalo_complete_scan(uuid, uuid, uuid, jsonb)') is not null
      and to_regprocedure('public.kalo_fail_scan(uuid, uuid, uuid)') is not null
      and to_regprocedure('public.kalo_save_ai_scan(uuid, uuid, text, jsonb)') is not null
      and to_regprocedure('public.kalo_start_purchase(uuid, uuid)') is not null
      and to_regprocedure('public.kalo_credit_purchase(uuid, uuid, text, text, text, text, integer, text)') is not null
      and exists (
        select 1 from pg_attribute where attrelid = to_regclass('public.diary_entries')
          and attname = 'ai_scan_id' and not attisdropped
      )
      and exists (
        select 1 from pg_trigger where tgrelid = to_regclass('public.users')
          and tgname = 'kalo_user_welcome_scans' and tgenabled in ('O', 'A')
      )
    ) as ready
  `);
  return rows[0]?.ready === true;
}
