ALTER TABLE "pro_invoices" DROP CONSTRAINT "pro_invoice_balance_check";--> statement-breakpoint
ALTER TABLE "scan_credit_transactions" DROP CONSTRAINT "scan_transaction_delta_check";--> statement-breakpoint
-- Existing invoices retain the amount and allowance of the original Pro plan.
ALTER TABLE "pro_invoices" ADD COLUMN "amount" integer DEFAULT 999 NOT NULL;--> statement-breakpoint
ALTER TABLE "pro_invoices" ADD COLUMN "credits" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "pro_invoices" ADD CONSTRAINT "pro_invoice_terms_check" CHECK (("pro_invoices"."amount" = 999 AND "pro_invoices"."credits" = 100) OR ("pro_invoices"."amount" = 799 AND "pro_invoices"."credits" = 120));--> statement-breakpoint
ALTER TABLE "pro_invoices" ADD CONSTRAINT "pro_invoice_balance_check" CHECK ("pro_invoices"."used" BETWEEN 0 AND "pro_invoices"."credits" AND "pro_invoices"."refunded_amount" BETWEEN 0 AND "pro_invoices"."amount");--> statement-breakpoint
ALTER TABLE "scan_credit_transactions" ADD CONSTRAINT "scan_transaction_delta_check" CHECK (("scan_credit_transactions"."kind" = 'welcome' AND "scan_credit_transactions"."delta" = 5) OR
    ("scan_credit_transactions"."kind" = 'purchase' AND "scan_credit_transactions"."delta" BETWEEN 1 AND 50) OR ("scan_credit_transactions"."kind" = 'pro' AND "scan_credit_transactions"."delta" BETWEEN 1 AND 120) OR
    ("scan_credit_transactions"."kind" = 'refund' AND "scan_credit_transactions"."delta" BETWEEN -120 AND -1) OR ("scan_credit_transactions"."kind" = 'scan' AND "scan_credit_transactions"."delta" = -1));
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kalo_scan_balance(p_user uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = public, pg_temp AS $$
  WITH month AS (
    SELECT date_trunc('month', now() AT TIME ZONE 'UTC')::date AS month_start
  ), paid_period AS (
    SELECT i.id, i.used, i.period_end, i.refunded_amount, i.amount, i.credits, s.checkout_id
    FROM pro_invoices i JOIN pro_subscriptions s ON s.id = i.subscription_id
    WHERE s.user_id = p_user AND i.status = 'paid' AND i.refunded_amount < i.amount
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
        ELSE greatest(0, i.credits - (i.credits * i.refunded_amount / i.amount) - i.used) END AS monthly
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
CREATE FUNCTION kalo_record_pro_invoice(
  p_invoice text, p_subscription text, p_intent text, p_event text, p_type text,
  p_start timestamptz, p_end timestamptz, p_created timestamptz, p_paid_at timestamptz, p_amount integer, p_credits integer
) RETURNS text
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE
  v_user uuid;
  v_refunded integer;
  v_granted integer;
BEGIN
  IF ((p_amount = 999 AND p_credits = 100) OR (p_amount = 799 AND p_credits = 120)) IS NOT TRUE THEN
    RETURN 'mismatch';
  END IF;
  -- Use the same lock order as pack payments and refunds.
  IF p_intent IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('kalo-intent:' || p_intent, 0));
  END IF;
  SELECT user_id INTO v_user FROM pro_subscriptions WHERE id = p_subscription;
  IF NOT FOUND THEN RETURN 'mismatch'; END IF;
  PERFORM 1 FROM scan_accounts WHERE user_id = v_user FOR UPDATE;
  IF EXISTS (SELECT 1 FROM pro_invoices WHERE id = p_invoice
        AND (subscription_id <> p_subscription OR amount <> p_amount OR credits <> p_credits))
      OR EXISTS (SELECT 1 FROM scan_purchases WHERE payment_intent_id = p_intent)
      OR EXISTS (SELECT 1 FROM pro_invoices WHERE payment_intent_id = p_intent AND id <> p_invoice) THEN
    RETURN 'mismatch';
  END IF;
  INSERT INTO stripe_webhook_events (id, type) VALUES (p_event, p_type) ON CONFLICT (id) DO NOTHING;
  IF NOT FOUND THEN RETURN 'duplicate'; END IF;

  IF p_intent IS NULL THEN
    INSERT INTO pro_invoices (id, subscription_id, period_start, period_end, status, created_at, amount, credits)
      VALUES (p_invoice, p_subscription, p_start, p_end, 'failed', p_created, p_amount, p_credits)
      ON CONFLICT (id) DO NOTHING;
    RETURN 'recorded';
  END IF;
  IF EXISTS (SELECT 1 FROM pro_invoices WHERE subscription_id = p_subscription AND status = 'paid'
      AND (id = p_invoice OR period_start = p_start)) THEN RETURN 'duplicate'; END IF;

  v_refunded := least(p_amount, coalesce((SELECT amount FROM stripe_scan_refunds WHERE payment_intent_id = p_intent), 0));
  v_granted := p_credits - p_credits * v_refunded / p_amount;
  INSERT INTO pro_invoices (id, subscription_id, payment_intent_id, period_start, period_end, status,
    created_at, paid_at, refunded_amount, amount, credits)
    VALUES (p_invoice, p_subscription, p_intent, p_start, p_end, 'paid', p_created, p_paid_at, v_refunded, p_amount, p_credits)
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
-- Allow the previous deployment to finish original-price invoices during rollout.
CREATE OR REPLACE FUNCTION kalo_record_pro_invoice(
  p_invoice text, p_subscription text, p_intent text, p_event text, p_type text,
  p_start timestamptz, p_end timestamptz, p_created timestamptz, p_paid_at timestamptz
) RETURNS text
LANGUAGE sql SET search_path = public, pg_temp AS $$
  SELECT kalo_record_pro_invoice(p_invoice, p_subscription, p_intent, p_event, p_type,
    p_start, p_end, p_created, p_paid_at, 999, 100);
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION kalo_apply_scan_refund(p_intent text, p_amount integer, p_event text, p_type text) RETURNS void
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
    v_total := least(v_total, v_invoice.amount);
    v_removed := least(greatest(0, v_invoice.credits - v_invoice.credits * v_invoice.refunded_amount / v_invoice.amount - v_invoice.used),
      v_invoice.credits * v_total / v_invoice.amount - v_invoice.credits * v_invoice.refunded_amount / v_invoice.amount);
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
