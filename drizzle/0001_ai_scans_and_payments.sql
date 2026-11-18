CREATE TABLE "ai_scans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"input_hash" varchar(64) NOT NULL,
	"status" varchar(12) NOT NULL,
	"lease_token" uuid NOT NULL,
	"lease_expires_at" timestamp with time zone NOT NULL,
	"result" jsonb,
	"saved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "ai_scans_status_check" CHECK ("ai_scans"."status" IN ('processing', 'succeeded', 'failed')),
	CONSTRAINT "ai_scans_result_check" CHECK ("ai_scans"."status" <> 'succeeded' OR "ai_scans"."result" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "scan_accounts" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"credits" integer DEFAULT 5 NOT NULL,
	CONSTRAINT "scan_credits_nonnegative" CHECK ("scan_accounts"."credits" >= 0)
);
--> statement-breakpoint
CREATE TABLE "scan_credit_transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"kind" varchar(12) NOT NULL,
	"reference" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "scan_credit_transactions_reference_unique" UNIQUE("reference"),
	CONSTRAINT "scan_transaction_balance_check" CHECK ("scan_credit_transactions"."balance_after" >= 0),
	CONSTRAINT "scan_transaction_delta_check" CHECK (("scan_credit_transactions"."kind" IN ('welcome', 'purchase') AND "scan_credit_transactions"."delta" = 5) OR ("scan_credit_transactions"."kind" = 'scan' AND "scan_credit_transactions"."delta" = -1))
);
--> statement-breakpoint
CREATE TABLE "scan_purchases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"checkout_session_id" text,
	"payment_intent_id" text,
	"credits" integer DEFAULT 5 NOT NULL,
	"amount" integer DEFAULT 499 NOT NULL,
	"currency" varchar(3) DEFAULT 'eur' NOT NULL,
	"status" varchar(12) DEFAULT 'pending' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"paid_at" timestamp with time zone,
	CONSTRAINT "scan_purchases_checkout_session_id_unique" UNIQUE("checkout_session_id"),
	CONSTRAINT "scan_purchases_payment_intent_id_unique" UNIQUE("payment_intent_id"),
	CONSTRAINT "scan_purchase_pack_check" CHECK ("scan_purchases"."credits" = 5 AND "scan_purchases"."amount" = 499 AND "scan_purchases"."currency" = 'eur'),
	CONSTRAINT "scan_purchase_status_check" CHECK ("scan_purchases"."status" IN ('pending', 'paid', 'expired', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "stripe_webhook_events" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "diary_entries" ADD COLUMN "ai_scan_id" uuid;--> statement-breakpoint
ALTER TABLE "ai_scans" ADD CONSTRAINT "ai_scans_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_accounts" ADD CONSTRAINT "scan_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_credit_transactions" ADD CONSTRAINT "scan_credit_transactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scan_purchases" ADD CONSTRAINT "scan_purchases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_scans_user_created_idx" ON "ai_scans" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ai_scans_one_processing_per_user" ON "ai_scans" USING btree ("user_id") WHERE "ai_scans"."status" = 'processing';--> statement-breakpoint
CREATE INDEX "scan_transactions_user_created_idx" ON "scan_credit_transactions" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "scan_purchases_user_created_idx" ON "scan_purchases" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "diary_entries" ADD CONSTRAINT "diary_entries_ai_scan_id_ai_scans_id_fk" FOREIGN KEY ("ai_scan_id") REFERENCES "public"."ai_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "diary_ai_scan_idx" ON "diary_entries" USING btree ("ai_scan_id");
--> statement-breakpoint
-- The migrator runs this migration in a transaction. Block signups briefly while
-- installing the trigger and backfilling so no existing/new user misses the grant.
LOCK TABLE users IN SHARE ROW EXCLUSIVE MODE;
--> statement-breakpoint
CREATE FUNCTION kalo_grant_welcome_scans() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  INSERT INTO scan_accounts (user_id, credits) VALUES (NEW.id, 5);
  INSERT INTO scan_credit_transactions (user_id, delta, balance_after, kind, reference)
    VALUES (NEW.id, 5, 5, 'welcome', 'welcome:' || NEW.id::text);
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER kalo_user_welcome_scans AFTER INSERT ON users
FOR EACH ROW EXECUTE FUNCTION kalo_grant_welcome_scans();
--> statement-breakpoint
INSERT INTO scan_accounts (user_id, credits) SELECT id, 5 FROM users ON CONFLICT (user_id) DO NOTHING;
--> statement-breakpoint
INSERT INTO scan_credit_transactions (user_id, delta, balance_after, kind, reference)
SELECT user_id, 5, 5, 'welcome', 'welcome:' || user_id::text FROM scan_accounts
ON CONFLICT (reference) DO NOTHING;
--> statement-breakpoint
-- All accounting functions lock the account FIRST. The lock protects the balance,
-- the single in-flight scan, rate limits, and the ledger within one transaction.
CREATE FUNCTION kalo_begin_scan(p_user uuid, p_id uuid, p_hash text, p_token uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_balance integer;
  v_scan ai_scans%ROWTYPE;
BEGIN
  SELECT credits INTO STRICT v_balance FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
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
  IF v_balance < 1 THEN
    RETURN jsonb_build_object('status', 'no_credits', 'credits', v_balance);
  END IF;
  IF (SELECT count(*) FROM ai_scans WHERE user_id = p_user AND created_at > now() - interval '1 hour') >= 30 THEN
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
CREATE FUNCTION kalo_complete_scan(p_user uuid, p_id uuid, p_token uuid, p_result jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_balance integer;
  v_scan ai_scans%ROWTYPE;
BEGIN
  SELECT credits INTO STRICT v_balance FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
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
  UPDATE scan_accounts SET credits = credits - 1 WHERE user_id = p_user AND credits > 0 RETURNING credits INTO v_balance;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'no_credits', 'credits', 0); END IF;
  UPDATE ai_scans SET status = 'succeeded', result = p_result, completed_at = now() WHERE id = p_id;
  INSERT INTO scan_credit_transactions (user_id, delta, balance_after, kind, reference)
    VALUES (p_user, -1, v_balance, 'scan', 'scan:' || p_id::text);
  RETURN jsonb_build_object('status', 'succeeded', 'credits', v_balance, 'result', p_result, 'saved', false);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_fail_scan(p_user uuid, p_id uuid, p_token uuid) RETURNS void
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  PERFORM 1 FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
  UPDATE ai_scans SET status = 'failed', completed_at = now()
    WHERE id = p_id AND user_id = p_user AND status = 'processing' AND lease_token = p_token;
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_start_purchase(p_user uuid, p_id uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_purchase scan_purchases%ROWTYPE;
BEGIN
  PERFORM 1 FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Account missing'; END IF;
  SELECT * INTO v_purchase FROM scan_purchases WHERE id = p_id;
  IF FOUND THEN
    IF v_purchase.user_id <> p_user THEN RETURN jsonb_build_object('status', 'conflict'); END IF;
    RETURN jsonb_build_object('status', v_purchase.status, 'sessionId', v_purchase.checkout_session_id);
  END IF;
  IF (SELECT count(*) FROM scan_purchases WHERE user_id = p_user AND created_at > now() - interval '1 hour') >= 20 THEN
    RETURN jsonb_build_object('status', 'rate_limited');
  END IF;
  INSERT INTO scan_purchases (id, user_id) VALUES (p_id, p_user) ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'conflict'); END IF;
  RETURN jsonb_build_object('status', 'pending', 'sessionId', null);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_credit_purchase(
  p_user uuid, p_purchase uuid, p_session text, p_intent text,
  p_event text, p_type text, p_amount integer, p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE v_balance integer; v_purchase scan_purchases%ROWTYPE;
BEGIN
  SELECT credits INTO STRICT v_balance FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
  SELECT * INTO v_purchase FROM scan_purchases WHERE id = p_purchase AND user_id = p_user FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'mismatch'); END IF;
  IF p_amount <> v_purchase.amount OR p_currency <> v_purchase.currency
      OR p_intent IS NULL OR p_intent = '' OR p_session IS NULL OR p_session = ''
      OR (v_purchase.checkout_session_id IS NOT NULL AND v_purchase.checkout_session_id <> p_session)
      OR (v_purchase.payment_intent_id IS NOT NULL AND v_purchase.payment_intent_id <> p_intent) THEN
    RETURN jsonb_build_object('status', 'mismatch');
  END IF;
  INSERT INTO stripe_webhook_events (id, type) VALUES (p_event, p_type) ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND OR v_purchase.status = 'paid' THEN
    RETURN jsonb_build_object('status', 'duplicate', 'credits', v_balance);
  END IF;
  UPDATE scan_purchases SET checkout_session_id = p_session, payment_intent_id = p_intent, status = 'paid', paid_at = now()
    WHERE id = p_purchase;
  UPDATE scan_accounts SET credits = credits + v_purchase.credits WHERE user_id = p_user RETURNING credits INTO v_balance;
  INSERT INTO scan_credit_transactions (user_id, delta, balance_after, kind, reference)
    VALUES (p_user, v_purchase.credits, v_balance, 'purchase', 'purchase:' || p_purchase::text);
  RETURN jsonb_build_object('status', 'credited', 'credits', v_balance);
END;
$$;
--> statement-breakpoint
CREATE FUNCTION kalo_save_ai_scan(p_user uuid, p_id uuid, p_date text, p_portions jsonb) RETURNS jsonb
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_scan ai_scans%ROWTYPE; v_food jsonb; v_grams numeric; v_ratio numeric; v_index integer := 0; v_entries jsonb;
BEGIN
  PERFORM 1 FROM scan_accounts WHERE user_id = p_user FOR UPDATE;
  SELECT * INTO v_scan FROM ai_scans WHERE id = p_id AND user_id = p_user AND status = 'succeeded' FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'not_found'); END IF;
  IF v_scan.saved_at IS NULL THEN
    IF p_date !~ '^\d{4}-\d{2}-\d{2}$' OR to_char(p_date::date, 'YYYY-MM-DD') <> p_date
       OR jsonb_typeof(p_portions) IS DISTINCT FROM 'array'
       OR jsonb_array_length(p_portions) <> jsonb_array_length(v_scan.result->'foods') THEN
      RAISE EXCEPTION 'Invalid diary input';
    END IF;
    FOR v_food IN SELECT value FROM jsonb_array_elements(v_scan.result->'foods') LOOP
      v_grams := (p_portions->>v_index)::numeric;
      IF v_grams IS NULL OR v_grams < 1 OR v_grams > 5000 THEN RAISE EXCEPTION 'Invalid portion'; END IF;
      v_ratio := v_grams / (v_food->>'portionGrams')::numeric;
      IF (v_food->>'kcal')::numeric * v_ratio > 25000
          OR (v_food->>'protein')::numeric * v_ratio > 10000
          OR (v_food->>'carbs')::numeric * v_ratio > 10000
          OR (v_food->>'fat')::numeric * v_ratio > 10000 THEN
        RETURN jsonb_build_object('status', 'invalid_portions');
      END IF;
      -- Validate all portions before writing any diary rows.
      v_index := v_index + 1;
    END LOOP;
    v_index := 0;
    FOR v_food IN SELECT value FROM jsonb_array_elements(v_scan.result->'foods') LOOP
      v_grams := (p_portions->>v_index)::numeric;
      v_ratio := v_grams / (v_food->>'portionGrams')::numeric;
      INSERT INTO diary_entries (user_id, date, name, grams, kcal, protein, carbs, fat, source, ai_scan_id)
        VALUES (p_user, p_date, v_food->>'name', v_grams, round((v_food->>'kcal')::numeric * v_ratio, 1),
          round((v_food->>'protein')::numeric * v_ratio, 1), round((v_food->>'carbs')::numeric * v_ratio, 1),
          round((v_food->>'fat')::numeric * v_ratio, 1), 'ai', p_id);
      v_index := v_index + 1;
    END LOOP;
    UPDATE ai_scans SET saved_at = now() WHERE id = p_id;
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'id', id, 'date', date, 'name', name, 'barcode', barcode, 'grams', grams, 'kcal', kcal,
    'protein', protein, 'carbs', carbs, 'fat', fat, 'image', image, 'source', source, 'aiScanId', ai_scan_id
  ) ORDER BY created_at, id), '[]'::jsonb) INTO v_entries FROM diary_entries WHERE ai_scan_id = p_id AND user_id = p_user;
  RETURN jsonb_build_object('status', 'saved', 'entries', v_entries);
END;
$$;
