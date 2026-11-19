# AI food photos and scan purchases

The barcode scanner remains free. AI photos require an account, start with five
free scans, and use one credit only after a valid estimate is saved on the server.
Five more scans cost **€4.99 EUR**, as a one-time Stripe Checkout payment.

## 1. Local environment and OpenAI

1. Use Node.js 20.9 or newer and run `npm ci`.
2. If you do not already have `.env.local`, copy `.env.example` to `.env.local`.
   Otherwise add the new variables without replacing your existing Neon or Open
   Food Facts settings. Never commit `.env.local` or use `NEXT_PUBLIC_` for keys.
3. In the [OpenAI platform](https://platform.openai.com/api-keys), create a project
   API key and enable API billing. Set `OPENAI_API_KEY` in `.env.local`.
4. `OPENAI_VISION_MODEL` defaults to `gpt-6-luna`, OpenAI's recommended
   replacement for GPT-4.1 mini. A custom model must support image inputs and
   structured outputs through the Responses API. Updated KALO also maps the old
   GPT-4.1 mini model name and snapshot to Luna. [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna)
5. Set `APP_URL=http://localhost:3000` for local Checkout return URLs.

Photo files are resized on the device, limited and checked again on the server,
and sent to OpenAI with `store: false`. KALO stores a request digest and the
nutrition estimate, not the original photo. Food names and estimate notes are
requested in the user's selected language.

## 2. Apply Neon migrations

1. Keep your existing `DATABASE_URL` pointing at the intended Neon database.
   Use a Neon branch/backup to rehearse the migration before production.
2. From the project directory run:

   ```bash
   npm run db:migrate
   ```

3. `0000_existing_schema.sql` safely adopts databases previously created by
   `db:push`: existing tables, indexes, constraints and diary data are preserved.
   `0001_ai_scans_and_payments.sql` adds the scan/payment tables, one nullable
   diary column, accounting functions, and the welcome-credit trigger. It grants
   **all existing users five credits** and grants future users five on signup.
4. Repeating `db:migrate` skips applied migrations. The runner uses the Drizzle
   journal and executes each migration and its history entry in a single Neon
   transaction, including the backfill. Do not run `db:push` for these features:
   it does not install the accounting functions, triggers, or backfill.
5. Never edit an applied migration. Generate a new migration for future changes.
   Run migrations once as a release step, before deploying the new app.

No production migration was run automatically during implementation.

## 3. Stripe Checkout and webhooks

1. Open the [Stripe Dashboard](https://dashboard.stripe.com/) in **test mode**.
   Copy the secret API key from Developers / API keys into `STRIPE_SECRET_KEY`.
   The hosted Checkout flow needs **no publishable key and no Stripe Price ID**.
   The server creates a fixed EUR 499-cent line item for five scans. No subscription,
   adjustable quantity, promotions, automatic tax, or adaptive currency conversion
   is enabled. Configure your available payment methods in Stripe Dashboard.
2. For local webhook delivery, install and authenticate the Stripe CLI, then run:

   ```bash
   stripe login
   stripe listen --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired --forward-to localhost:3000/api/stripe/webhook
   ```

3. Copy the listener's `whsec_...` value to `STRIPE_WEBHOOK_SECRET`, then start or
   restart the app with `npm run dev`. The CLI listener must stay running.
4. Sign in, open **Food scanner → AI food photo**, and buy a pack. Use Stripe's
   test card `4242 4242 4242 4242`, any future expiry and any three-digit CVC.
   A real Checkout session created by this app is required; a generic CLI test
   event has no matching purchase record and cannot grant credits.
5. Confirm that purchase history shows **Paid** and the balance increases by five.
   Returning to `?checkout=success` alone never grants scans. If a webhook is late,
   the UI waits and lets you refresh. Test a second pack and resend the same event
   from Stripe: the balance must only increase once per paid purchase.
6. For production, activate your Stripe account, use the **live** secret key, and
   create a live webhook event destination in Developers / Workbench → Webhooks:
   `https://YOUR_DOMAIN/api/stripe/webhook`. Subscribe to the four events above.
   Use snapshot events with API version **2026-10-28.endive**, matching the installed
   Stripe SDK. Copy that endpoint's signing secret into the production
   `STRIPE_WEBHOOK_SECRET`; it differs from the CLI and test endpoint secrets.

The webhook verifies the original request-body signature and timestamp, retrieves
the Checkout session from Stripe, verifies paid status, ownership, pack, amount,
currency and line items, then atomically records the event, purchase, credit and
ledger entry. Event, session, purchase and payment-intent uniqueness protect
against replay and duplicate credits. Unpaid/failed/expired payments grant none.

## 4. Vercel settings and release

In **Project → Settings → Environment Variables**, configure these for the
environments you deploy:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | The intended Neon pooled connection string |
| `OFF_CONTACT_EMAIL` | Your existing Open Food Facts contact email |
| `OPENAI_API_KEY` | A server-side OpenAI project API key with API billing |
| `OPENAI_VISION_MODEL` | Optional. Defaults to `gpt-6-luna` |
| `STRIPE_SECRET_KEY` | Live key for Production; test key for Preview/Development |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for that environment's webhook endpoint |
| `APP_URL` | Exact public HTTPS origin, e.g. `https://kalo.example.com` |

Use separate Neon branches and Stripe test credentials for Preview. `APP_URL`
must match the deployment users open; use a stable preview domain and matching
test webhook destination when testing payments on Vercel. Vercel Deployment
Protection must allow Stripe to reach the webhook endpoint. Redeploy after
changing variables. Keys are read at runtime and are never sent to the browser.

Apply `npm run db:migrate` to each target database before the app deployment. Do
not add live migrations to `next build`. Configure a Node.js 22 or 24 Vercel
runtime. The scan route allows up to 90 seconds; its OpenAI call times out after
60 seconds, and abandoned scan slots expire after two minutes without a charge.

## 5. Verification

```bash
npm run typecheck
npm test
npm run check:pwa
npm run build
```

If a restricted local environment blocks Turbopack's CSS worker from opening a
local socket, use `npm run build -- --webpack` for the production build.

The automated tests run the actual SQL migrations and accounting functions in
PGlite (PostgreSQL in WASM), exercise API routes with real Stripe test signatures
and mocked external API responses, and render the password form in all four
languages. Queued parallel requests, replays, credit exhaustion, failures, stale
leases, user isolation, and idempotent diary saves are covered. No live paid API
calls or production database changes are required by the test suite.

Before release, exercise an actual food photo with your OpenAI key and a real
Stripe test Checkout with webhook delivery. These require configured credentials.

## Admin panel and device sessions

1. Sign in to the KALO account that should administer the deployment.
2. Open `/api/auth/me` on the same KALO domain and copy the UUID in `user.id`.
3. In Vercel Project Settings → Environment Variables, set the server variable
   `KALO_ADMIN_USER_IDS` to that UUID for the target environment. For multiple
   admins, enter the UUIDs separated by commas. For local development, use
   `.env.local`.
4. Deploy the updated code. Open **My profile → Admin panel** or `/admin` while
   signed in. The panel shows user names, emails, registration dates, active
   session start times, and scan balances. It also shows whether the scanner's
   database and provider variables are configured.

Signing in on a new device replaces the account's previous server session.
The previous device loses account access as soon as the sign-in completes and
its screen returns to sign-in on the next session check, within about 15 seconds
while the app is visible or when it comes back into focus. This uses the
existing session table.

If **AI database** shows **Needs setup**, confirm that `DATABASE_URL` points
to the same Neon database and branch as the Vercel deployment, then apply
`npm run db:migrate` using the steps above. Existing accounts and the free
barcode scanner work during AI setup.

## Changed files

| Area | Files |
| --- | --- |
| UI | `components/ai-food-scanner.tsx`, `components/scanner-hub.tsx`, `components/auth-modal.tsx`, `components/kalo-app.tsx`, `app/globals.css` |
| AI routes | `app/api/ai/credits/route.ts`, `app/api/ai/scans/route.ts`, `app/api/ai/scans/[id]/route.ts`, `app/api/ai/scans/[id]/diary/route.ts` |
| Payments | `app/api/stripe/checkout/route.ts`, `app/api/stripe/webhook/route.ts`, `lib/stripe.ts` |
| Server/client helpers | `lib/food-vision.ts`, `lib/food-photo-bytes.ts`, `lib/scan-accounting.ts`, `lib/ai-http.ts`, `lib/client-api.ts`, `lib/prepare-food-photo.ts` |
| Types, validation, languages | `lib/ai-types.ts`, `lib/ai-validation.ts`, `lib/types.ts`, `lib/validations.ts`, `lib/feature-i18n.ts`, `lib/i18n.ts` |
| Database | `db/schema.ts`, `drizzle/0000_existing_schema.sql`, `drizzle/0001_ai_scans_and_payments.sql`, `drizzle/meta/0000_snapshot.json`, `drizzle/meta/0001_snapshot.json`, `drizzle/meta/_journal.json`, `scripts/migrate.mjs` |
| Tests | `tests/database-helpers.ts`, `tests/scan-accounting.test.ts`, `tests/ai-routes.test.ts`, `tests/food-vision.test.ts`, `tests/ai-scanner-ui.test.tsx`, `tests/password-confirmation.test.tsx`, `vitest.config.ts` |
| Setup | `package.json`, `package-lock.json`, `.env.example`, `README.md`, `SETUP-AI.md` |

The existing barcode scanner component and product lookup route were not modified.
