"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Check, ChevronLeft, ChevronRight, CreditCard, ImagePlus, Info, LoaderCircle, LogIn, Plus, RefreshCw, Sparkles, Upload } from "lucide-react";
import { translations, intlLocale } from "@/lib/i18n";
import type { DiaryItem, Locale, SessionUser } from "@/lib/types";
import type { CreditsResponse, ScanDiaryResponse, ScanResponse } from "@/lib/ai-types";
import { scaleEstimatedFood } from "@/lib/ai-types";
import { scanApi, ScanApiError } from "@/lib/client-api";
import { prepareFoodPhoto } from "@/lib/prepare-food-photo";
import { savePhotoScanSchema } from "@/lib/ai-validation";

interface Props {
  locale: Locale; user: SessionUser | null; today: string; openAuth: () => void;
  onEntriesAdded: (entries: DiaryItem[]) => void; notify: (message: string, error?: boolean) => void;
}

export function AiFoodScanner({ locale, user, today, openAuth, onEntriesAdded, notify }: Props) {
  const t = translations[locale];
  const [account, setAccount] = useState<CreditsResponse | null>(null);
  const [accountError, setAccountError] = useState("");
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [recovering, setRecovering] = useState(false);
  const [recoveryVersion, setRecoveryVersion] = useState(0);
  const [scan, setScan] = useState<ScanResponse | null>(null);
  const [portions, setPortions] = useState<string[]>([]);
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState("");
  const [payment, setPayment] = useState<"pending" | "confirmed" | "cancel" | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const request = useRef<{ id: string; locale: Locale } | null>(null);
  const checkoutRequest = useRef<{ id: string; locale: Locale } | null>(null);
  const scanStorageKey = user ? `kalo_ai_scan:${user.id}` : "";
  const number = (n: number) => new Intl.NumberFormat(intlLocale[locale], { maximumFractionDigits: 1 }).format(n);

  const showResult = useCallback((result: ScanResponse) => {
    setScan(result); setPortions(result.result.foods.map(food => String(food.portionGrams)));
    setAccount(value => value ? { ...value, credits: result.credits } : value);
  }, []);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    if (!user) return null;
    setRefreshing(true);
    try {
      const data = await scanApi<CreditsResponse>(`/api/ai/credits?page=${page}`, locale, undefined, signal);
      if (!signal?.aborted) { setAccount(data); setAccountError(""); }
      return data;
    } catch (e) {
      if (!signal?.aborted) {
        setAccount(null);
        setAccountError(e instanceof Error ? e.message : t.genericError);
      }
      return null;
    } finally { if (!signal?.aborted) setRefreshing(false); }
  }, [user, page, locale, t.genericError]);

  useEffect(() => {
    const controller = new AbortController();
    void refresh(controller.signal);
    const onFocus = () => { void refresh(controller.signal); };
    window.addEventListener("focus", onFocus);
    return () => { controller.abort(); window.removeEventListener("focus", onFocus); };
  }, [refresh]);

  useEffect(() => {
    if (!user) return;
    const params = new URLSearchParams(window.location.search);
    const checkout = params.get("checkout");
    const purchaseId = params.get("purchase");
    if (checkout === "cancel") { setPayment("cancel"); return; }
    if (checkout !== "success" || !purchaseId) return;
    setPayment("pending");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const poll = async () => {
      try {
        const data = await scanApi<CreditsResponse>("/api/ai/credits?page=1", locale, undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (data.purchases.some(p => p.id === purchaseId && p.status === "paid")) {
          setPayment("confirmed"); setPage(1); setAccount(data); return;
        }
      } catch { if (controller.signal.aborted) return; }
      if (++attempts < 30) timer = setTimeout(() => void poll(), 2000);
    };
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [user, locale]);

  useEffect(() => {
    if (payment !== "pending") return;
    const id = new URLSearchParams(window.location.search).get("purchase");
    if (account?.purchases.some(p => p.id === id && p.status === "paid")) setPayment("confirmed");
  }, [account, payment]);

  // Recover a completed scan after a lost response, navigation, or Checkout redirect.
  useEffect(() => {
    if (!user) return;
    let id: string | null = null;
    try { id = sessionStorage.getItem(scanStorageKey); } catch { /* Storage may be disabled. */ }
    if (!id) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    setRecovering(true);
    const recover = async () => {
      try {
        const result = await scanApi<ScanResponse & { status: string }>(`/api/ai/scans/${id}`, locale, undefined, controller.signal);
        if (controller.signal.aborted) return;
        if (result.status === "succeeded") showResult(result);
        else if (result.status === "processing" && ++attempts < 60) { timer = setTimeout(() => void recover(), 2000); return; }
        else { try { sessionStorage.removeItem(scanStorageKey); } catch { /* Optional recovery. */ } }
      } catch (e) {
        if (controller.signal.aborted) return;
        if (e instanceof ScanApiError && e.code === "aiScanNotFound") {
          try { sessionStorage.removeItem(scanStorageKey); } catch { /* Optional recovery. */ }
        } else setError(e instanceof Error ? e.message : t.genericError);
      }
      setRecovering(false);
    };
    void recover();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [user, scanStorageKey, locale, recoveryVersion, showResult, t.genericError]);

  const selectPhoto = async (file?: File) => {
    if (!file || scanning || preparing || recovering) return;
    setPreparing(true); setError("");
    try {
      const prepared = await prepareFoodPhoto(file);
      setPhoto(prepared); setScan(null); setPortions([]);
      request.current = { id: crypto.randomUUID(), locale };
      try { sessionStorage.removeItem(scanStorageKey); } catch { /* Optional recovery. */ }
    } catch (e) { setError(new ScanApiError(e instanceof Error ? e.message : "aiInvalidPhoto", locale).message); }
    finally { setPreparing(false); if (fileRef.current) fileRef.current.value = ""; if (cameraRef.current) cameraRef.current.value = ""; }
  };

  const analyze = async () => {
    if (!photo || !user || scanning || scan || recovering) return;
    setScanning(true); setError("");
    request.current ??= { id: crypto.randomUUID(), locale };
    const current = request.current;
    try { sessionStorage.setItem(scanStorageKey, current.id); } catch { /* Optional recovery. */ }
    try {
      const result = await scanApi<ScanResponse>("/api/ai/scans", locale, { requestId: current.id, locale: current.locale, image: photo });
      showResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.genericError);
      if (e instanceof ScanApiError && ["aiNoFood", "aiScanFailed", "aiRetryScan"].includes(e.code)) {
        request.current = null;
        try { sessionStorage.removeItem(scanStorageKey); } catch { /* Optional recovery. */ }
      } else if (!(e instanceof ScanApiError) || ["aiServiceError", "aiScanBusy"].includes(e.code)) {
        // A lost response can hide a successful, charged scan. Recover it before
        // allowing a new photo to replace its request key.
        setRecoveryVersion(value => value + 1);
      }
      void refresh();
    } finally { setScanning(false); }
  };

  const buy = async () => {
    if (buying || !user) return;
    setBuying(true); setError("");
    checkoutRequest.current ??= { id: crypto.randomUUID(), locale };
    try {
      const { url } = await scanApi<{ url: string }>("/api/stripe/checkout", locale, { requestId: checkoutRequest.current.id, locale: checkoutRequest.current.locale });
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : t.genericError);
      if (e instanceof ScanApiError && e.code === "aiCheckoutFinished") checkoutRequest.current = null;
      setBuying(false);
    }
  };

  const save = async () => {
    if (!scan || scan.saved || saving) return;
    const input = savePhotoScanSchema.safeParse({ date, portions: portions.map(Number) });
    if (!input.success) { setError(t.aiInvalidPortions); return; }
    setSaving(true); setError("");
    try {
      const { entries } = await scanApi<ScanDiaryResponse>(`/api/ai/scans/${scan.id}/diary`, locale, input.data);
      onEntriesAdded(entries); setScan(value => value ? { ...value, saved: true } : value); notify(t.aiSaved);
    } catch (e) { setError(e instanceof Error ? e.message : t.genericError); }
    finally { setSaving(false); }
  };

  const busy = preparing || scanning || recovering;
  const validPortions = portions.length > 0 && portions.every(p => p.trim() !== "" && Number.isFinite(Number(p)) && Number(p) >= 1 && Number(p) <= 5000);
  const nutrients = scan?.result.foods.map((food, i) => scaleEstimatedFood(food, validPortions ? Number(portions[i]) : food.portionGrams)) || [];
  const totals = nutrients.reduce((sum, n) => ({ kcal: sum.kcal + n.kcal, protein: sum.protein + n.protein, carbs: sum.carbs + n.carbs, fat: sum.fat + n.fat }), { kcal: 0, protein: 0, carbs: 0, fat: 0 });
  const purchaseLabels = { paid: t.aiPaid, pending: t.aiPending, expired: t.aiExpired, failed: t.aiFailed };

  return <div className="view fade-in ai-view">
    <div className="view-header"><div><span className="eyebrow"><Sparkles size={15}/> {t.photoTab}</span><h1>{t.aiTitle}</h1><p>{t.aiSubtitle}</p></div><span className="header-illustration"><ImagePlus size={40} strokeWidth={1.2}/></span></div>
    <p className="subtle-note"><Sparkles size={15}/>{t.aiFree}</p>
    {!user ? <section className="card ai-login"><div className="icon-badge olive"><Sparkles size={24}/></div><h2>{t.photoTab}</h2><p>{t.aiLoginRequired}</p><button className="btn btn-primary" onClick={openAuth}><LogIn size={17}/>{t.login}</button></section> : <>
      <section className="card ai-credit-card" aria-label={t.aiCredits}>
        <div className="ai-credit-balance"><span className="icon-badge olive"><Sparkles size={22}/></span><div><span>{t.aiCredits}</span><strong>{account ? number(account.credits) : "—"}</strong></div></div>
        <div className="ai-pack"><button type="button" className="btn btn-primary" disabled={buying || busy || !account?.checkoutAvailable} onClick={() => void buy()}>{buying ? <LoaderCircle size={18} className="spin"/> : <CreditCard size={18}/>} {t.aiPack}</button><small>{t.aiPackNote}</small></div>
        <button className="icon-button" type="button" onClick={() => void refresh()} aria-label={t.aiRefresh} disabled={refreshing}><RefreshCw size={18} className={refreshing ? "spin" : ""}/></button>
      </section>
      {accountError && <p className="form-error" role="alert">{accountError}</p>}
      {payment && <div className={`ai-payment-notice ${payment === "confirmed" ? "confirmed" : ""}`} role="status">{payment === "confirmed" ? <Check size={20}/> : <Info size={20}/>}<p>{payment === "pending" ? t.aiPaymentPending : payment === "confirmed" ? t.aiPaymentConfirmed : t.aiPaymentCanceled}</p></div>}
      {account && !account.checkoutAvailable && <p className="subtle-note"><Info size={15}/>{t.aiCheckoutUnavailable}</p>}
      {account && !account.scanningAvailable && <p className="form-error">{t.aiUnavailable}</p>}
      {account?.credits === 0 && <p className="ai-no-credits">{t.aiNoCredits}</p>}
      <section className="card ai-photo-card">
        <div className={`ai-photo-stage ${photo ? "has-photo" : ""}`}>{photo ? <img src={photo} alt={t.aiPhotoAlt}/> : <div><ImagePlus size={52} strokeWidth={1.2}/><p>{t.aiSubtitle}</p></div>}
          {busy && <div className="ai-photo-loading" role="status"><LoaderCircle size={32} className="spin"/><span>{preparing ? t.aiPreparing : t.aiAnalyzing}</span></div>}
        </div>
        <div className="ai-photo-actions"><button type="button" className="btn btn-outline" disabled={busy || saving} onClick={() => cameraRef.current?.click()}><Camera size={18}/>{t.aiTakePhoto}</button>
          <button type="button" className="btn btn-outline" disabled={busy || saving} onClick={() => fileRef.current?.click()}><Upload size={18}/>{t.aiUpload}</button>
          <input ref={cameraRef} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" className="visually-hidden" aria-label={t.aiTakePhoto} onChange={e => void selectPhoto(e.target.files?.[0])}/>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" className="visually-hidden" aria-label={t.aiUpload} onChange={e => void selectPhoto(e.target.files?.[0])}/>
          {!scan && <button type="button" className="btn btn-primary" disabled={!photo || busy || !account?.scanningAvailable || !account.credits} onClick={() => void analyze()}>{scanning ? <LoaderCircle size={18} className="spin"/> : <Sparkles size={18}/>} {t.aiAnalyze}</button>}
        </div>
        <p className="subtle-note">{t.aiPhotoHint}</p><p className="subtle-note"><Info size={14}/>{t.aiPrivacy}</p>
      </section>
      {error && <p className="form-error ai-error" role="alert">{error}</p>}
      {scan && <section className="card ai-results" aria-label={t.aiResults}>
        <div className="panel-heading"><div><span className="ai-estimate-badge"><Sparkles size={13}/>{t.aiBadge}</span><h2>{t.aiResults}</h2></div>{scan.saved && <span className="ai-saved"><Check size={17}/>{t.aiSaved}</span>}</div>
        <p className="ai-estimate-note"><Info size={17}/>{t.aiEstimate}</p>
        <div className="ai-food-list">{scan.result.foods.map((food, i) => <article className="ai-food" key={i}>
          <div className="ai-food-title"><span className="ai-food-number">{i + 1}</span><h3>{food.name}</h3><span>{number(nutrients[i].kcal)} {t.kcal}</span></div>
          <div className="ai-food-detail"><div className="field"><label htmlFor={`ai-portion-${i}`}>{t.portion} ({t.grams})</label><input id={`ai-portion-${i}`} type="number" inputMode="decimal" step="1" min="1" max="5000" required disabled={scan.saved || saving} value={portions[i] ?? ""} onChange={e => setPortions(values => values.map((v, index) => index === i ? e.target.value : v))}/></div>
            <div className="ai-food-macros"><span>{t.protein}<strong>{number(nutrients[i].protein)} {t.grams}</strong></span><span>{t.carbs}<strong>{number(nutrients[i].carbs)} {t.grams}</strong></span><span>{t.fat}<strong>{number(nutrients[i].fat)} {t.grams}</strong></span></div></div>
        </article>)}</div>
        <div className="ai-meal-total"><div><span>{t.aiTotal}</span><strong>{number(totals.kcal)} <small>{t.kcal}</small></strong></div><div className="ai-food-macros"><span>{t.protein}<strong>{number(totals.protein)} {t.grams}</strong></span><span>{t.carbs}<strong>{number(totals.carbs)} {t.grams}</strong></span><span>{t.fat}<strong>{number(totals.fat)} {t.grams}</strong></span></div></div>
        {scan.result.notes && <p className="ai-model-note"><strong>{t.aiNotes}: </strong>{scan.result.notes}</p>}
        <div className="ai-save-row"><div className="field"><label htmlFor="ai-diary-date">{t.navDiary}</label><input type="date" id="ai-diary-date" value={date} disabled={scan.saved || saving} onChange={e => setDate(e.target.value)}/></div>
          <button className="btn btn-primary" type="button" disabled={saving || scan.saved || !validPortions || !date} onClick={() => void save()}>{saving ? <LoaderCircle size={18} className="spin"/> : scan.saved ? <Check size={18}/> : <Plus size={18}/>} {scan.saved ? t.aiSaved : t.aiSave}</button>
        </div>
      </section>}
      <details className="card ai-history"><summary>{t.aiHistory}</summary>
        {!account?.purchases.length ? <p className="subtle-note">{t.aiNoPurchases}</p> : <ul>{account.purchases.map(purchase => <li key={purchase.id}>
          <div><strong>{purchase.credits} {t.aiScans}</strong><small>{new Intl.DateTimeFormat(intlLocale[locale], { dateStyle: "medium", timeStyle: "short" }).format(new Date(purchase.createdAt))}</small></div>
          <span className={`ai-purchase-status ${purchase.status}`}>{purchaseLabels[purchase.status]}</span>
          <strong>{new Intl.NumberFormat(intlLocale[locale], { style: "currency", currency: purchase.currency }).format(purchase.amount / 100)}</strong>
        </li>)}</ul>}
        <div className="ai-history-pages"><button className="btn btn-outline" type="button" disabled={page <= 1 || refreshing} onClick={() => setPage(v => v - 1)}><ChevronLeft size={16}/>{t.previous}</button><span>{number(page)}</span><button className="btn btn-outline" type="button" disabled={!account?.hasMore || refreshing} onClick={() => setPage(v => v + 1)}>{t.next}<ChevronRight size={16}/></button></div>
      </details>
    </>}
  </div>;
}
