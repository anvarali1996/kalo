-- Coordinate with the existing signup trigger for the duration of the migration.
LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE TABLE "auth_rate_limits" (
	"bucket" text NOT NULL,
	"key_hash" varchar(64) NOT NULL,
	"attempts" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "auth_rate_limits_bucket_key_hash_pk" PRIMARY KEY("bucket","key_hash")
);
--> statement-breakpoint
CREATE TABLE "basic_scan_months" (
	"user_id" uuid NOT NULL,
	"month_start" date NOT NULL,
	"used" smallint DEFAULT 0 NOT NULL,
	CONSTRAINT "basic_scan_months_user_id_month_start_pk" PRIMARY KEY("user_id","month_start"),
	CONSTRAINT "basic_scan_usage_check" CHECK ("basic_scan_months"."used" BETWEEN 0 AND 6)
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"token_hash" varchar(64) NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "password_reset_tokens_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "pro_checkouts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"stripe_price_id" text NOT NULL,
	"locale" varchar(2) NOT NULL,
	"checkout_session_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pro_checkouts_checkout_session_id_unique" UNIQUE("checkout_session_id"),
	CONSTRAINT "pro_checkout_status_check" CHECK ("pro_checkouts"."status" IN ('pending', 'completed', 'expired'))
);
--> statement-breakpoint
CREATE TABLE "pro_invoices" (
	"id" text PRIMARY KEY NOT NULL,
	"subscription_id" text NOT NULL,
	"payment_intent_id" text,
	"period_start" timestamp with time zone NOT NULL,
	"period_end" timestamp with time zone NOT NULL,
	"status" text NOT NULL,
	"used" smallint DEFAULT 0 NOT NULL,
	"refunded_amount" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "pro_invoices_payment_intent_id_unique" UNIQUE("payment_intent_id"),
	CONSTRAINT "pro_invoice_period_check" CHECK ("pro_invoices"."period_end" > "pro_invoices"."period_start"),
	CONSTRAINT "pro_invoice_state_check" CHECK (("pro_invoices"."status" = 'paid' AND "pro_invoices"."payment_intent_id" IS NOT NULL AND "pro_invoices"."paid_at" IS NOT NULL) OR
    ("pro_invoices"."status" = 'failed' AND "pro_invoices"."payment_intent_id" IS NULL AND "pro_invoices"."paid_at" IS NULL)),
	CONSTRAINT "pro_invoice_balance_check" CHECK ("pro_invoices"."used" BETWEEN 0 AND 100 AND "pro_invoices"."refunded_amount" BETWEEN 0 AND 999)
);
--> statement-breakpoint
CREATE TABLE "pro_subscriptions" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"checkout_id" uuid NOT NULL,
	"status" text NOT NULL,
	"current_period_end" timestamp with time zone,
	"cancel_at" timestamp with time zone,
	"last_event_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "pro_subscriptions_checkout_id_unique" UNIQUE("checkout_id")
);
--> statement-breakpoint
CREATE TABLE "stripe_scan_refunds" (
	"payment_intent_id" text PRIMARY KEY NOT NULL,
	"amount" integer NOT NULL,
	CONSTRAINT "stripe_scan_refund_amount_check" CHECK ("stripe_scan_refunds"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "scan_credit_transactions" DROP CONSTRAINT "scan_transaction_delta_check";--> statement-breakpoint
ALTER TABLE "scan_purchases" DROP CONSTRAINT "scan_purchase_pack_check";--> statement-breakpoint
ALTER TABLE "scan_purchases" DROP CONSTRAINT "scan_purchase_status_check";--> statement-breakpoint
ALTER TABLE "scan_accounts" ALTER COLUMN "credits" SET DEFAULT 0;--> statement-breakpoint
ALTER TABLE "scan_accounts" ADD COLUMN "stripe_customer_id" text;--> statement-breakpoint
ALTER TABLE "scan_purchases" ADD COLUMN "pack_code" varchar(20) DEFAULT 'kalo_5_scans_v1' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_purchases" ADD COLUMN "stripe_price_id" text;--> statement-breakpoint
ALTER TABLE "scan_purchases" ADD COLUMN "locale" varchar(2) DEFAULT 'en' NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_purchases" ADD COLUMN "remaining_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "scan_purchases" ADD COLUMN "refunded_amount" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "basic_scan_months" ADD CONSTRAINT "basic_scan_months_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_checkouts" ADD CONSTRAINT "pro_checkouts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_invoices" ADD CONSTRAINT "pro_invoices_subscription_id_pro_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."pro_subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_subscriptions" ADD CONSTRAINT "pro_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pro_subscriptions" ADD CONSTRAINT "pro_subscriptions_checkout_id_pro_checkouts_id_fk" FOREIGN KEY ("checkout_id") REFERENCES "public"."pro_checkouts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "auth_rate_limit_expiry_idx" ON "auth_rate_limits" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "pro_checkout_user_created_idx" ON "pro_checkouts" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pro_checkout_pending_user_idx" ON "pro_checkouts" USING btree ("user_id") WHERE "pro_checkouts"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "pro_invoice_subscription_created_idx" ON "pro_invoices" USING btree ("subscription_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "pro_paid_invoice_period_idx" ON "pro_invoices" USING btree ("subscription_id","period_start") WHERE "pro_invoices"."status" = 'paid';--> statement-breakpoint
CREATE INDEX "pro_subscription_user_idx" ON "pro_subscriptions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "scan_purchases_spend_idx" ON "scan_purchases" USING btree ("user_id","paid_at","id") WHERE "scan_purchases"."remaining_credits" > 0;--> statement-breakpoint
ALTER TABLE "scan_accounts" ADD CONSTRAINT "scan_accounts_stripe_customer_id_unique" UNIQUE("stripe_customer_id");--> statement-breakpoint
ALTER TABLE "scan_credit_transactions" ADD CONSTRAINT "scan_transaction_delta_check" CHECK (("scan_credit_transactions"."kind" = 'welcome' AND "scan_credit_transactions"."delta" = 5) OR
    ("scan_credit_transactions"."kind" = 'purchase' AND "scan_credit_transactions"."delta" BETWEEN 1 AND 50) OR ("scan_credit_transactions"."kind" = 'pro' AND "scan_credit_transactions"."delta" BETWEEN 1 AND 100) OR
    ("scan_credit_transactions"."kind" = 'refund' AND "scan_credit_transactions"."delta" BETWEEN -100 AND -1) OR ("scan_credit_transactions"."kind" = 'scan' AND "scan_credit_transactions"."delta" = -1));--> statement-breakpoint
ALTER TABLE "scan_purchases" ADD CONSTRAINT "scan_purchase_refund_check" CHECK ("scan_purchases"."refunded_amount" BETWEEN 0 AND "scan_purchases"."amount" AND "scan_purchases"."remaining_credits" BETWEEN 0 AND "scan_purchases"."credits");--> statement-breakpoint
ALTER TABLE "scan_purchases" ADD CONSTRAINT "scan_purchase_pack_check" CHECK ("scan_purchases"."currency" = 'eur' AND (
    ("scan_purchases"."pack_code" = 'kalo_5_scans_v1' AND "scan_purchases"."credits" = 5 AND "scan_purchases"."amount" = 499 AND "scan_purchases"."stripe_price_id" IS NULL) OR
    ("scan_purchases"."pack_code" = 'pack20' AND "scan_purchases"."credits" = 20 AND "scan_purchases"."amount" = 299 AND "scan_purchases"."stripe_price_id" IS NOT NULL) OR
    ("scan_purchases"."pack_code" = 'pack50' AND "scan_purchases"."credits" = 50 AND "scan_purchases"."amount" = 599 AND "scan_purchases"."stripe_price_id" IS NOT NULL)));--> statement-breakpoint
ALTER TABLE "scan_purchases" ADD CONSTRAINT "scan_purchase_status_check" CHECK ("scan_purchases"."status" IN ('pending', 'paid', 'expired', 'failed', 'refunded'));
--> statement-breakpoint
-- Older credits were fungible. Allocate the surviving balance to the newest
-- paid packs first (FIFO spending), and leave any unused welcome credits in
-- the same non-expiring account balance.
WITH old_packs AS (
  SELECT p.id, p.credits, a.credits AS balance,
    coalesce(sum(p.credits) OVER (
      PARTITION BY p.user_id ORDER BY p.paid_at DESC NULLS LAST, p.created_at DESC, p.id DESC
      ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING
    ), 0) AS newer_credits
  FROM scan_purchases p JOIN scan_accounts a USING (user_id)
  WHERE p.status = 'paid'
)
UPDATE scan_purchases p SET remaining_credits = greatest(0, least(o.credits, o.balance - o.newer_credits))
FROM old_packs o WHERE p.id = o.id;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kalo_grant_welcome_scans() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO scan_accounts (user_id, credits) VALUES (NEW.id, 0);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_scan_balance(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH month AS (
    SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::date AS month_start
  ), paid_period AS (
    SELECT i.id, i.used, i.period_end, i.refunded_amount, s.checkout_id
    FROM pro_invoices i JOIN pro_subscriptions s ON s.id = i.subscription_id
    WHERE s.user_id = p_user AND i.status = 'paid' AND i.refunded_amount < 999
      AND i.period_start <= now() AND i.period_end > now()
    ORDER BY i.period_start DESC, i.id DESC LIMIT 1
  ), subscription AS (
    SELECT s.id, s.status, s.cancel_at, s.current_period_end
    FROM pro_subscriptions s WHERE s.user_id = p_user
    ORDER BY (s.status NOT IN ('canceled', 'incomplete_expired')) DESC, s.created_at DESC, s.id DESC LIMIT 1
  ), balance AS (
    SELECT a.credits AS purchased, a.stripe_customer_id IS NOT NULL AS has_customer,
      m.month_start, i.id AS invoice_id, i.checkout_id,
      coalesce(i.period_end, (m.month_start + interval '1 month') AT TIME ZONE 'UTC') AS expires_at,
      CASE WHEN i.id IS NULL THEN 6 - coalesce(b.used, 0)
        ELSE greatest(0, 100 - (100 * i.refunded_amount / 999) - i.used) END AS monthly
    FROM scan_accounts a CROSS JOIN month m LEFT JOIN paid_period i ON true
      LEFT JOIN basic_scan_months b ON b.user_id = a.user_id AND b.month_start = m.month_start
    WHERE a.user_id = p_user
  )
  SELECT jsonb_build_object(
    'credits', b.monthly + b.purchased, 'monthlyCredits', b.monthly, 'purchasedCredits', b.purchased,
    'plan', CASE WHEN b.invoice_id IS NULL THEN 'basic' ELSE 'pro' END,
    'monthlyExpiresAt', b.expires_at, 'invoiceId', b.invoice_id, 'proCheckoutId', b.checkout_id,
    'subscriptionStatus', s.status,
    'renewalAt', CASE WHEN s.status IN ('active', 'trialing') AND s.cancel_at IS NULL THEN s.current_period_end END,
    'cancelAt', s.cancel_at, 'hasStripeCustomer', b.has_customer,
    'canSubscribe', b.invoice_id IS NULL AND (
      s.id IS NULL OR s.status IN ('canceled', 'incomplete_expired') OR
      (s.status = 'incomplete' AND EXISTS (SELECT 1 FROM pro_checkouts
        WHERE user_id = p_user AND status = 'pending' AND expires_at > now()))
    )
  ) FROM balance b LEFT JOIN subscription s ON true;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kalo_begin_scan(p_user uuid, p_id uuid, p_hash text, p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_balance integer;
  v_scan ai_scans%ROWTYPE;
BEGIN
  PERFORM 1 FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE no_data_found; END IF;
  v_balance := (kalo_scan_balance(p_user)->>'credits')::integer;
  SELECT * INTO v_scan FROM ai_scans WHERE id = p_id;
  IF FOUND THEN
    IF v_scan.user_id <> p_user OR v_scan.input_hash <> p_hash THEN
      RETURN jsonb_build_object('status', 'conflict', 'credits', v_balance);
    END IF;
    IF v_scan.status = 'succeeded' THEN
      RETURN jsonb_build_object('status', 'succeeded', 'credits', v_balance, 'result', v_scan.result, 'saved', v_scan.saved_at IS NOT NULL);
    END IF;
    IF v_scan.status = 'processing' AND v_scan.lease_expires_at > now() THEN
      RETURN jsonb_build_object('status', 'busy', 'credits', v_balance);
    END IF;
    UPDATE ai_scans SET status = 'failed', completed_at = now() WHERE id = p_id AND status = 'processing';
    RETURN jsonb_build_object('status', 'failed', 'credits', v_balance);
  END IF;
  UPDATE ai_scans SET status = 'failed', completed_at = now()
    WHERE user_id = p_user AND status = 'processing' AND lease_expires_at <= now();
  IF EXISTS (SELECT 1 FROM ai_scans WHERE user_id = p_user AND status = 'processing') THEN
    RETURN jsonb_build_object('status', 'busy', 'credits', v_balance);
  END IF;
  IF v_balance < 1 THEN RETURN jsonb_build_object('status', 'no_credits', 'credits', v_balance); END IF;
  IF (SELECT count(*) FROM ai_scans WHERE user_id = p_user AND status = 'failed'
      AND created_at > now() - interval '1 hour') >= 30 THEN
    RETURN jsonb_build_object('status', 'rate_limited', 'credits', v_balance);
  END IF;
  INSERT INTO ai_scans (id, user_id, input_hash, status, lease_token, lease_expires_at)
    VALUES (p_id, p_user, p_hash, 'processing', p_token, now() + interval '2 minutes')
    ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict', 'credits', v_balance); END IF;
  RETURN jsonb_build_object('status', 'started', 'credits', v_balance);
END;
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kalo_complete_scan(p_user uuid, p_id uuid, p_token uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_credit jsonb;
  v_balance integer;
  v_scan ai_scans%ROWTYPE;
  v_pack uuid;
BEGIN
  PERFORM 1 FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE no_data_found; END IF;
  v_credit := kalo_scan_balance(p_user);
  v_balance := (v_credit->>'credits')::integer;
  SELECT * INTO v_scan FROM ai_scans WHERE id = p_id AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict', 'credits', v_balance); END IF;
  IF v_scan.status = 'succeeded' THEN
    RETURN jsonb_build_object('status', 'succeeded', 'credits', v_balance, 'result', v_scan.result, 'saved', v_scan.saved_at IS NOT NULL);
  END IF;
  IF v_scan.status <> 'processing' OR v_scan.lease_token <> p_token OR v_scan.lease_expires_at <= now() THEN
    RETURN jsonb_build_object('status', 'expired', 'credits', v_balance);
  END IF;
  IF p_result IS NULL OR p_result->>'containsFood' IS DISTINCT FROM 'true'
      OR jsonb_typeof(p_result->'foods') IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'Invalid food estimate';
  END IF;
  IF jsonb_array_length(p_result->'foods') NOT BETWEEN 1 AND 12 THEN RAISE EXCEPTION 'Invalid food count'; END IF;
  IF v_balance < 1 THEN
    UPDATE ai_scans SET status = 'failed', completed_at = now() WHERE id = p_id;
    RETURN jsonb_build_object('status', 'no_credits', 'credits', 0);
  END IF;

  IF (v_credit->>'monthlyCredits')::integer > 0 THEN
    IF v_credit->>'invoiceId' IS NOT NULL THEN
      UPDATE pro_invoices SET used = used + 1 WHERE id = v_credit->>'invoiceId';
    ELSE
      INSERT INTO basic_scan_months (user_id, month_start, used)
        VALUES (p_user, date_trunc('month', now() AT TIME ZONE 'UTC')::date, 1)
        ON CONFLICT (user_id, month_start) DO UPDATE SET used = basic_scan_months.used + 1;
    END IF;
  ELSE
    -- Use any unallocated welcome credits before the oldest remaining pack lot.
    IF (v_credit->>'purchasedCredits')::integer = (
      SELECT coalesce(sum(remaining_credits), 0) FROM scan_purchases WHERE user_id = p_user AND remaining_credits > 0
    ) THEN
      SELECT id INTO STRICT v_pack FROM scan_purchases WHERE user_id = p_user AND remaining_credits > 0
        ORDER BY paid_at, created_at, id LIMIT 1;
      UPDATE scan_purchases SET remaining_credits = remaining_credits - 1 WHERE id = v_pack;
    END IF;
    UPDATE scan_accounts SET credits = credits - 1 WHERE user_id = p_user;
  END IF;

  UPDATE ai_scans SET status = 'succeeded', result = p_result, completed_at = now() WHERE id = p_id;
  INSERT INTO scan_credit_transactions (user_id, delta, balance_after, kind, reference)
    VALUES (p_user, -1, v_balance - 1, 'scan', 'scan:' || p_id::text);
  RETURN jsonb_build_object('status', 'succeeded', 'credits', v_balance - 1, 'result', p_result, 'saved', false);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_start_pack(p_user uuid, p_id uuid, p_pack text, p_price text, p_locale text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_purchase scan_purchases%ROWTYPE;
BEGIN
  PERFORM 1 FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE no_data_found; END IF;
  SELECT * INTO v_purchase FROM scan_purchases WHERE id = p_id;
  IF FOUND THEN
    IF v_purchase.user_id <> p_user OR v_purchase.pack_code <> p_pack THEN
      RETURN jsonb_build_object('status', 'conflict');
    END IF;
  ELSE
    IF (SELECT count(*) FROM scan_purchases WHERE user_id = p_user AND created_at > now() - interval '1 hour') >= 20 THEN
      RETURN jsonb_build_object('status', 'rate_limited');
    END IF;
    INSERT INTO scan_purchases (id, user_id, pack_code, stripe_price_id, locale, credits, amount)
      VALUES (p_id, p_user, p_pack, p_price, p_locale,
        CASE p_pack WHEN 'pack20' THEN 20 WHEN 'pack50' THEN 50 END,
        CASE p_pack WHEN 'pack20' THEN 299 WHEN 'pack50' THEN 599 END)
      ON CONFLICT (id) DO NOTHING RETURNING * INTO v_purchase;
    IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict'); END IF;
  END IF;
  RETURN jsonb_build_object('status', v_purchase.status, 'sessionId', v_purchase.checkout_session_id,
    'priceId', v_purchase.stripe_price_id, 'locale', v_purchase.locale);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_reserve_pro_checkout(p_user uuid, p_id uuid, p_price text, p_locale text) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_checkout pro_checkouts%ROWTYPE;
BEGIN
  PERFORM 1 FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE no_data_found; END IF;
  UPDATE pro_checkouts SET status = 'expired' WHERE user_id = p_user AND status = 'pending' AND expires_at <= now();
  IF NOT (kalo_scan_balance(p_user)->>'canSubscribe')::boolean THEN
    RETURN jsonb_build_object('status', 'subscribed');
  END IF;
  SELECT * INTO v_checkout FROM pro_checkouts WHERE id = p_id;
  IF FOUND THEN
    IF v_checkout.user_id <> p_user THEN RETURN jsonb_build_object('status', 'conflict'); END IF;
  ELSE
    SELECT * INTO v_checkout FROM pro_checkouts WHERE user_id = p_user AND status = 'pending';
    IF NOT FOUND THEN
      IF (SELECT count(*) FROM pro_checkouts WHERE user_id = p_user AND created_at > now() - interval '1 hour') >= 10 THEN
        RETURN jsonb_build_object('status', 'rate_limited');
      END IF;
      INSERT INTO pro_checkouts (id, user_id, stripe_price_id, locale, expires_at)
        VALUES (p_id, p_user, p_price, p_locale, date_trunc('second', now()) + interval '1 hour')
        ON CONFLICT (id) DO NOTHING RETURNING * INTO v_checkout;
      IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict'); END IF;
    END IF;
  END IF;
  RETURN jsonb_build_object('status', v_checkout.status, 'id', v_checkout.id, 'priceId', v_checkout.stripe_price_id,
    'locale', v_checkout.locale, 'sessionId', v_checkout.checkout_session_id,
    'expiresAt', extract(epoch from v_checkout.expires_at)::bigint);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_sync_pro_subscription(
  p_user uuid, p_checkout uuid, p_customer text, p_id text, p_status text,
  p_created timestamptz, p_period_end timestamptz, p_cancel_at timestamptz, p_event_at timestamptz
) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM scan_accounts WHERE user_id = p_user AND stripe_customer_id = p_customer FOR UPDATE;
  IF NOT FOUND OR NOT EXISTS (SELECT 1 FROM pro_checkouts WHERE id = p_checkout AND user_id = p_user)
    THEN RETURN false; END IF;
  IF EXISTS (SELECT 1 FROM pro_subscriptions
    WHERE (id = p_id AND (user_id <> p_user OR checkout_id <> p_checkout))
       OR (checkout_id = p_checkout AND id <> p_id)) THEN RETURN false; END IF;

  INSERT INTO pro_subscriptions (id, user_id, checkout_id, status, created_at, current_period_end, cancel_at, last_event_at)
    VALUES (p_id, p_user, p_checkout, p_status, p_created, p_period_end, p_cancel_at, p_event_at)
    ON CONFLICT (id) DO UPDATE SET status = excluded.status, current_period_end = excluded.current_period_end,
      cancel_at = excluded.cancel_at, last_event_at = excluded.last_event_at
    WHERE pro_subscriptions.last_event_at <= excluded.last_event_at
      AND (pro_subscriptions.status NOT IN ('canceled', 'incomplete_expired')
        OR pro_subscriptions.status = excluded.status);
  IF p_status <> 'incomplete' THEN
    UPDATE pro_checkouts SET status = 'completed' WHERE id = p_checkout;
  END IF;
  RETURN true;
END;
$$;
--> statement-breakpoint
-- Grants and refunds for the same Stripe payment lock the intent FIRST and the
-- account SECOND. Scan spending only takes the account lock.
CREATE OR REPLACE FUNCTION kalo_credit_purchase(
  p_user uuid, p_purchase uuid, p_session text, p_intent text,
  p_event text, p_type text, p_amount integer, p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_purchase scan_purchases%ROWTYPE;
  v_granted integer;
  v_refunded integer;
BEGIN
  IF coalesce(p_intent, '') = '' OR coalesce(p_session, '') = '' THEN
    RETURN jsonb_build_object('status', 'mismatch');
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('kalo-intent:' || p_intent, 0));
  PERFORM 1 FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'mismatch'); END IF;
  SELECT * INTO v_purchase FROM scan_purchases WHERE id = p_purchase AND user_id = p_user FOR UPDATE;
  IF NOT FOUND OR p_amount IS DISTINCT FROM v_purchase.amount OR p_currency IS DISTINCT FROM v_purchase.currency
      OR (v_purchase.checkout_session_id IS NOT NULL AND v_purchase.checkout_session_id <> p_session)
      OR (v_purchase.payment_intent_id IS NOT NULL AND v_purchase.payment_intent_id <> p_intent)
      OR EXISTS (SELECT 1 FROM pro_invoices WHERE payment_intent_id = p_intent) THEN
    RETURN jsonb_build_object('status', 'mismatch');
  END IF;
  INSERT INTO stripe_webhook_events (id, type) VALUES (p_event, p_type) ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND OR v_purchase.status IN ('paid', 'refunded') THEN
    RETURN jsonb_build_object('status', 'duplicate', 'credits', (kalo_scan_balance(p_user)->>'credits')::integer);
  END IF;

  v_refunded := least(p_amount, coalesce((SELECT amount FROM stripe_scan_refunds WHERE payment_intent_id = p_intent), 0));
  v_granted := v_purchase.credits - v_purchase.credits * v_refunded / p_amount;
  UPDATE scan_purchases SET checkout_session_id = p_session, payment_intent_id = p_intent,
    status = CASE WHEN v_refunded = p_amount THEN 'refunded' ELSE 'paid' END,
    paid_at = now(), remaining_credits = v_granted, refunded_amount = v_refunded
    WHERE id = p_purchase;
  IF v_granted > 0 THEN
    UPDATE scan_accounts SET credits = credits + v_granted WHERE user_id = p_user;
    INSERT INTO scan_credit_transactions (user_id, delta, balance_after, kind, reference)
      VALUES (p_user, v_granted, (kalo_scan_balance(p_user)->>'credits')::integer, 'purchase', 'purchase:' || p_purchase);
  END IF;
  RETURN jsonb_build_object('status', 'credited', 'credits', (kalo_scan_balance(p_user)->>'credits')::integer);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_record_pro_invoice(
  p_invoice text, p_subscription text, p_intent text, p_event text, p_type text,
  p_start timestamptz, p_end timestamptz, p_created timestamptz, p_paid_at timestamptz
) RETURNS text
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid;
  v_refunded integer;
  v_granted integer;
BEGIN
  IF p_intent IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('kalo-intent:' || p_intent, 0));
  END IF;
  SELECT user_id INTO v_user FROM pro_subscriptions WHERE id = p_subscription;
  IF NOT FOUND THEN RETURN 'mismatch'; END IF;
  PERFORM 1 FROM scan_accounts WHERE user_id = v_user FOR UPDATE;
  IF EXISTS (SELECT 1 FROM pro_invoices WHERE id = p_invoice AND subscription_id <> p_subscription)
      OR EXISTS (SELECT 1 FROM scan_purchases WHERE payment_intent_id = p_intent)
      OR EXISTS (SELECT 1 FROM pro_invoices WHERE payment_intent_id = p_intent AND id <> p_invoice) THEN
    RETURN 'mismatch';
  END IF;
  INSERT INTO stripe_webhook_events (id, type) VALUES (p_event, p_type) ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  IF p_intent IS NULL THEN
    INSERT INTO pro_invoices (id, subscription_id, period_start, period_end, status, created_at)
      VALUES (p_invoice, p_subscription, p_start, p_end, 'failed', p_created)
      ON CONFLICT (id) DO NOTHING;
    RETURN 'recorded';
  END IF;
  IF EXISTS (SELECT 1 FROM pro_invoices WHERE subscription_id = p_subscription AND status = 'paid'
      AND (id = p_invoice OR period_start = p_start)) THEN RETURN 'duplicate'; END IF;

  v_refunded := least(999, coalesce((SELECT amount FROM stripe_scan_refunds WHERE payment_intent_id = p_intent), 0));
  v_granted := 100 - 100 * v_refunded / 999;
  INSERT INTO pro_invoices (id, subscription_id, payment_intent_id, period_start, period_end, status, created_at, paid_at, refunded_amount)
    VALUES (p_invoice, p_subscription, p_intent, p_start, p_end, 'paid', p_created, p_paid_at, v_refunded)
    ON CONFLICT (id) DO UPDATE SET payment_intent_id = excluded.payment_intent_id, status = 'paid',
      period_start = excluded.period_start, period_end = excluded.period_end,
      paid_at = excluded.paid_at, refunded_amount = excluded.refunded_amount;
  IF v_granted > 0 THEN
    INSERT INTO scan_credit_transactions (user_id, delta, balance_after, kind, reference)
      VALUES (v_user, v_granted, (kalo_scan_balance(v_user)->>'credits')::integer, 'pro', 'invoice:' || p_invoice);
  END IF;
  RETURN 'recorded';
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_apply_scan_refund(p_intent text, p_amount integer, p_event text, p_type text) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid;
  v_pack scan_purchases%ROWTYPE;
  v_invoice pro_invoices%ROWTYPE;
  v_total integer;
  v_removed integer;
BEGIN
  IF p_amount <= 0 THEN RETURN; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('kalo-intent:' || p_intent, 0));
  IF p_event IS NOT NULL THEN
    INSERT INTO stripe_webhook_events (id, type) VALUES (p_event, p_type) ON CONFLICT (id) DO NOTHING;
    IF NOT FOUND THEN RETURN; END IF;
  END IF;
  -- Keep successful refunds even if the matching paid event has not arrived.
  INSERT INTO stripe_scan_refunds (payment_intent_id, amount) VALUES (p_intent, p_amount)
    ON CONFLICT (payment_intent_id) DO UPDATE SET amount = greatest(stripe_scan_refunds.amount, excluded.amount)
    RETURNING amount INTO v_total;

  SELECT user_id INTO v_user FROM scan_purchases WHERE payment_intent_id = p_intent;
  IF FOUND THEN
    PERFORM 1 FROM scan_accounts WHERE user_id = v_user FOR UPDATE;
    SELECT * INTO STRICT v_pack FROM scan_purchases WHERE payment_intent_id = p_intent;
    v_total := least(v_total, v_pack.amount);
    v_removed := least(v_pack.remaining_credits,
      v_pack.credits * v_total / v_pack.amount - v_pack.credits * v_pack.refunded_amount / v_pack.amount);
    UPDATE scan_purchases SET refunded_amount = v_total, remaining_credits = remaining_credits - v_removed,
      status = CASE WHEN v_total = amount THEN 'refunded' ELSE status END WHERE id = v_pack.id;
    UPDATE scan_accounts SET credits = credits - v_removed WHERE user_id = v_user;
  ELSE
    SELECT s.user_id INTO v_user FROM pro_invoices i JOIN pro_subscriptions s ON s.id = i.subscription_id
      WHERE i.payment_intent_id = p_intent;
    IF NOT FOUND THEN RETURN; END IF;
    PERFORM 1 FROM scan_accounts WHERE user_id = v_user FOR UPDATE;
    SELECT * INTO STRICT v_invoice FROM pro_invoices WHERE payment_intent_id = p_intent;
    v_total := least(v_total, 999);
    v_removed := least(greatest(0, 100 - 100 * v_invoice.refunded_amount / 999 - v_invoice.used),
      100 * v_total / 999 - 100 * v_invoice.refunded_amount / 999);
    IF (kalo_scan_balance(v_user)->>'invoiceId') IS DISTINCT FROM v_invoice.id THEN v_removed := 0; END IF;
    UPDATE pro_invoices SET refunded_amount = v_total WHERE id = v_invoice.id;
  END IF;
  IF v_removed > 0 THEN
    INSERT INTO scan_credit_transactions (user_id, delta, balance_after, kind, reference)
      VALUES (v_user, -v_removed, (kalo_scan_balance(v_user)->>'credits')::integer, 'refund',
        'refund:' || p_intent || ':' || v_total);
  END IF;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_auth_attempt(p_bucket text, p_key text, p_limit integer, p_seconds integer) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO auth_rate_limits (bucket, key_hash, attempts, expires_at)
    VALUES (p_bucket, p_key, 1, now() + make_interval(secs => p_seconds))
    ON CONFLICT (bucket, key_hash) DO UPDATE
      SET attempts = CASE WHEN auth_rate_limits.expires_at <= now() THEN 1 ELSE auth_rate_limits.attempts + 1 END,
          expires_at = CASE WHEN auth_rate_limits.expires_at <= now() THEN excluded.expires_at ELSE auth_rate_limits.expires_at END
      WHERE auth_rate_limits.expires_at <= now() OR auth_rate_limits.attempts < p_limit;
  RETURN FOUND;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_issue_password_reset(p_user uuid, p_token_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
    VALUES (p_user, p_token_hash, now() + interval '30 minutes')
    ON CONFLICT (user_id) DO UPDATE SET token_hash = excluded.token_hash, expires_at = excluded.expires_at;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_password_updated() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  DELETE FROM sessions WHERE user_id = NEW.id;
  DELETE FROM password_reset_tokens WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kalo_invalidate_credentials AFTER UPDATE OF password_hash ON users
  FOR EACH ROW WHEN (OLD.password_hash IS DISTINCT FROM NEW.password_hash) EXECUTE FUNCTION kalo_password_updated();
--> statement-breakpoint
CREATE FUNCTION kalo_redeem_password_reset(p_token_hash text, p_new_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM password_reset_tokens WHERE token_hash = p_token_hash AND expires_at > now();
  IF NOT FOUND THEN RETURN false; END IF;
  PERFORM 1 FROM users WHERE id = v_user FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  -- Explicitly consume the token even if the supplied hash equals the old hash.
  DELETE FROM password_reset_tokens WHERE user_id = v_user AND token_hash = p_token_hash AND expires_at > now();
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE users SET password_hash = p_new_hash WHERE id = v_user;
  RETURN true;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_change_password(p_user uuid, p_session text, p_old_hash text, p_new_hash text) RETURNS boolean
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM users WHERE id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE users SET password_hash = p_new_hash WHERE id = p_user AND password_hash = p_old_hash
    AND EXISTS (
      SELECT 1 FROM (SELECT token_hash, expires_at FROM sessions WHERE user_id = p_user
        ORDER BY created_at DESC, id DESC LIMIT 1) AS latest
      WHERE latest.token_hash = p_session AND latest.expires_at > now()
    );
  RETURN FOUND;
END;
$$;
