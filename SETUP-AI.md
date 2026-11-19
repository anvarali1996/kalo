# Set up Kalo Balance

Basic includes 6 AI photo scans per UTC calendar month. Pro costs €7.99 EUR per month and includes 120 scans per paid Stripe billing period. One-time packs cost €2.99 EUR for 20 scans and €5.99 EUR for 50. Barcode scanning is free.

Monthly scans are used first and expire at the end of the applicable period. Purchased scans and unused credits carried forward from the former plan have no expiration date. A paid Pro period replaces the Basic allowance while it is active. The current Basic month's prior usage resumes when that Pro period ends.

## 1. Neon and OpenAI

1. Use Node.js 20.9 or later and run `npm ci`. Add the variables from `.env.example` to `.env.local`.
2. In Neon, use a separate development branch for testing. Put its connection string in `DATABASE_URL` in `.env.local`. From the project folder on macOS or Linux, run `env -u DATABASE_URL npm run db:migrate` so the command reads the value from the file. The checked-in SQL is applied in order, with each migration and its journal entry committed in one transaction.
3. Migration `0002_plans_and_passwords` keeps users, sessions, diaries, payments, and original remaining scan balances. It adds monthly usage, Stripe billing records, and password reset storage. If the database predates AI scanning, migration `0001` first applies its original welcome-credit backfill. The balances present when `0002` runs are carried forward.
   Migration `0003_pro_repricing` stores the amount and scan allowance for each Pro invoice. Existing €9.99 invoices keep their original 100-scan allowance, usage and refunds.
4. Set `OPENAI_API_KEY` to an OpenAI project key with API billing enabled. `OPENAI_VISION_MODEL` is optional and defaults to `gpt-6-luna`. Use a model that supports image inputs and structured outputs in the Responses API. [OpenAI model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna)

Use `npm run db:migrate` for these releases. It installs the accounting and password functions, triggers, and backfills. Keep development and production database connections in their intended environments. [Neon connection guide](https://neon.com/docs/connect/connect-from-any-app)

## 2. Stripe test environment

1. In the Stripe Dashboard, switch to a test sandbox. Create the following three EUR prices and put each `price_…` identifier in its matching variable. For Pro, select a flat recurring price, billed once per month.

   | Variable | Stripe price |
   | --- | --- |
   | `STRIPE_PRO_PRICE_ID` | €7.99 EUR every month |
   | `STRIPE_PACK20_PRICE_ID` | €2.99 EUR one-time |
   | `STRIPE_PACK50_PRICE_ID` | €5.99 EUR one-time |

2. Add the sandbox secret key as `STRIPE_SECRET_KEY`. Enable card payments for Checkout. Set `APP_URL=http://localhost:3000` for local testing. In Stripe **Settings → Billing → Customer portal**, enable payment method updates, invoice history, and cancellation at the end of the billing period. Leave price and quantity changes, trial options, and cancellation offers disabled. The app uses the default portal configuration unless `STRIPE_PORTAL_CONFIGURATION_ID` is set to a dedicated `bpc_…` configuration. [Stripe Customer Portal](https://docs.stripe.com/customer-management/configure-portal)
3. In one terminal, sign in to your Stripe sandbox with `stripe login`, then start a listener for the exact events below. Copy the listener's `whsec_…` value into `STRIPE_WEBHOOK_SECRET` in `.env.local`. The listener and Dashboard endpoint each have their own signing secret. [Stripe CLI listener](https://docs.stripe.com/cli/listen)

   ```bash
   stripe listen \
     --events checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.async_payment_failed,checkout.session.expired,customer.subscription.created,customer.subscription.updated,customer.subscription.deleted,invoice.paid,invoice.payment_failed,charge.refunded,refund.created,refund.updated \
     --forward-to http://localhost:3000/api/stripe/webhook
   ```

4. Start `npm run dev` in a second terminal. Sign in, open **Food scanner → AI food photo → Plans and credits**, and complete a pack purchase and a Pro subscription on separate test accounts. Use Stripe's test card `4242 4242 4242 4242` with a future expiry and any valid CVC. Verify the new balance after the webhook arrives. Open **Manage billing** to schedule cancellation. Issue a sandbox refund and confirm the purchase or invoice shows its refund. [Stripe test cards](https://docs.stripe.com/testing#cards) · [Stripe subscription events](https://docs.stripe.com/billing/subscriptions/webhooks)
5. Test renewals using the sandbox, or a Stripe test clock if needed. A clock advances Stripe's timestamps while the app compares them with actual UTC. Automated tests cover the expired-period boundary, failed renewal, and successful retry.

Checkout redirects display payment progress. Billing fulfillment requires a signed webhook and current Stripe payment data, including a successful Stripe PaymentIntent for a Pro invoice. Failed renewals do not issue a new allowance. Cancellation retains the paid allowance through the period end. A successful refund revokes the corresponding unspent scans, with partial refunds prorated and rounded down when calculating the number to revoke. Past scans and diary entries remain recorded. Legacy paid and pending pack payments continue to be recognized. Stripe's hosted pages use English for the Uzbek app locale.

## 3. Resend password recovery

1. In Resend, add a sending domain you control and publish its required DNS records. Wait for Resend to verify it. Keep click tracking disabled on the sender so reset links use the application's address directly. [Resend domains](https://resend.com/docs/dashboard/domains/introduction)
2. Create a sending API key and set `RESEND_API_KEY`. Set `RESEND_FROM_EMAIL` to a sender on that verified domain, for example `"Kalo Balance <accounts@example.com>"`. Use the exact site origin as `APP_URL`. For localhost, open the reset email on the same computer as the app. [Resend Send Email API](https://resend.com/docs/api-reference/emails/send-email)
3. From **Sign in**, select **Forgot password?** and request a link for a test account. The email link opens `/reset-password`. Set a new password, then verify old password login and the link are rejected. In **My profile → Change password**, try a wrong current password before testing a successful change.

Only the newest reset link can be redeemed. It lasts 30 minutes, and the database stores its hash. Forgot-password responses acknowledge known, unknown, and rate-limited inboxes the same way. Limits include three reset emails per inbox per hour, 12 reset-link requests per address per hour, 20 redemption attempts per address per 15 minutes, and five authenticated change attempts per account per 15 minutes.

## 4. Vercel settings and manual release

Set these in **Project → Environment Variables** for the correct target environment. Keep sandbox Stripe credentials and development Neon in Preview, and use the matching live configuration only in Production.

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | Intended Neon branch connection string |
| `APP_URL` | Exact app origin, such as `https://kalo-steel.vercel.app` |
| `OPENAI_API_KEY` | Server-side OpenAI project key |
| `OPENAI_VISION_MODEL` | Optional. Defaults to `gpt-6-luna` |
| `STRIPE_SECRET_KEY` | Stripe secret key for this environment |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for this environment's webhook |
| `STRIPE_PRO_PRICE_ID` | €7.99 EUR monthly Pro Price ID |
| `STRIPE_PACK20_PRICE_ID` | One-time EUR 20-scan Price ID |
| `STRIPE_PACK50_PRICE_ID` | One-time EUR 50-scan Price ID |
| `STRIPE_PORTAL_CONFIGURATION_ID` | Optional Stripe Portal configuration ID |
| `RESEND_API_KEY` | Resend sending key |
| `RESEND_FROM_EMAIL` | Sender on your verified domain |
| `KALO_ADMIN_USER_IDS` | Existing comma-separated Kalo administrator UUIDs |
| `OFF_CONTACT_EMAIL` | Existing Open Food Facts contact email |

For a hosted environment, create a **Stripe Workbench → Webhooks** destination with snapshot events at `{APP_URL}/api/stripe/webhook` and select exactly the events in the local listener command. Use the destination's own signing secret. Rehearse the migration on a Neon branch first. When ready for release, put the connection string for the exact Vercel Production Neon branch in local `.env.local` and confirm the selected branch before manually running `env -u DATABASE_URL npm run db:migrate`. Then deploy the updated app so the new variables are loaded, and restore your local development connection string. [Stripe event destinations](https://docs.stripe.com/webhooks) · [Vercel environment variables](https://vercel.com/docs/environment-variables/managing-environment-variables)

For an existing Pro rollout, create a new €7.99 EUR recurring monthly Price under the Pro product and use its ID in `STRIPE_PRO_PRICE_ID` for the new deployment. Open Checkouts at the earlier price can complete until they expire. If any are still open at cutover, expire them in Stripe or let them expire within an hour. [Stripe prices](https://docs.stripe.com/products-prices/manage-prices#create-a-price) · [Checkout expiry](https://docs.stripe.com/api/checkout/sessions/expire)

After deploying, move existing Pro subscriptions by replacing the price on each existing subscription item, keeping quantity 1 and its billing date, with prorations disabled (`proration_behavior=none`). The paid period keeps its original terms. The first verified €7.99 renewal grants 120 scans. [Stripe subscription price changes](https://docs.stripe.com/billing/subscriptions/change-price) · [Stripe subscription update options](https://docs.stripe.com/api/subscriptions/update)

The admin list remains available through **My profile → Admin panel**. To find your user UUID, sign in on the intended Kalo domain and open `/api/auth/me`. Copy `user.id` into `KALO_ADMIN_USER_IDS`. The admin scanner setup indicator checks the schema and provider settings, and existing single-device sign-in remains in effect.

## 5. Local verification

```bash
npm run typecheck
npm test
npm run check:pwa
npm run build
```

Tests apply the migrations to an isolated PostgreSQL-compatible database and exercise the route handlers with mocked Stripe, OpenAI, and Resend calls. For a failed OpenAI analysis on a deployed app, search Vercel logs for `KALO OpenAI scan failed`.
