"use client";

import { CreditCard, LoaderCircle } from "lucide-react";
import { translations, intlLocale } from "@/lib/i18n";
import type { CreditsResponse } from "@/lib/ai-types";
import { basicMonthlyScans, pricing, type BillingProduct } from "@/lib/pricing";
import type { Locale } from "@/lib/types";

export const formatEuro = (cents: number, locale: Locale) =>
  new Intl.NumberFormat(intlLocale[locale], { style: "currency", currency: "EUR" }).format(cents / 100);

interface Props {
  locale: Locale;
  account: CreditsResponse | null;
  signedIn: boolean;
  buying: BillingProduct | "portal" | null;
  busy: boolean;
  onBuy: (product: BillingProduct) => void;
}

export function BillingPlans({ locale, account, signedIn, buying, busy, onBuy }: Props) {
  const t = translations[locale];
  const buyDisabled = (product: BillingProduct) => busy || buying !== null ||
    (signedIn && (!account?.availableProducts.includes(product) || (product === "pro" && !account.canSubscribe)));
  const buy = (product: BillingProduct, label: string) => <button className="btn btn-primary" type="button"
    disabled={buyDisabled(product)} onClick={() => onBuy(product)}>
    {buying === product ? <LoaderCircle size={16} className="spin"/> : <CreditCard size={16}/>}
    {label}
  </button>;

  return <section className="card billing-plans" id="scan-plans" aria-labelledby="scan-plans-title">
    <div className="panel-heading"><div><h2 id="scan-plans-title">{t.billingPlans}</h2><p>{t.billingSpendOrder}</p></div></div>
    <div className="billing-plan-grid">
      <article className="billing-plan">
        <h3>Basic</h3><strong>{t.billingFree}</strong>
        <p>{t.billingBasicDetail.replace("{count}", String(basicMonthlyScans))}</p>
        {account?.plan === "basic" && <small>{t.billingCurrentPlan}</small>}
      </article>
      <article className="billing-plan billing-plan-pro">
        <h3>Pro</h3><strong>{formatEuro(pricing.pro.cents, locale)} <small>{t.billingPerMonth}</small></strong>
        <p>{t.billingProDetail.replace("{count}", String(pricing.pro.scans))}. {t.billingNoDailyLimit}</p>
        {account?.plan === "pro" ? <small>{t.billingCurrentPlan}</small> : buy("pro", t.billingSubscribe)}
      </article>
      {(["pack20", "pack50"] as const).map(product => <article key={product} className="billing-plan">
        <h3>{t.billingPackLabel.replace("{count}", String(pricing[product].scans))}</h3>
        <strong>{formatEuro(pricing[product].cents, locale)}</strong><p>{t.billingOneTime}</p>
        {buy(product, t.billingBuyPack.replace("{count}", String(pricing[product].scans)))}
      </article>)}
    </div>
    {signedIn && account && account.availableProducts.length === 0 && <p className="subtle-note">{t.aiCheckoutUnavailable}</p>}
  </section>;
}
