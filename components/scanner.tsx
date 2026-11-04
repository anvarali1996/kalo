"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Barcode, Camera, CameraOff, Check, ChevronRight, Info, LoaderCircle, Package, Plus, ScanLine, Search, Upload, X } from "lucide-react";
import type { DiaryItem, Locale, Product } from "@/lib/types";
import { scale } from "@/lib/calories";
import { translations } from "@/lib/i18n";

interface Props {
  locale: Locale;
  addEntry: (entry: Omit<DiaryItem, "id">) => Promise<void>;
  notify: (message: string, isError?: boolean) => void;
  today: string;
}

const show = (value: number | null, unit = "g") => value === null ? "—" : `${Math.round(value * 10) / 10} ${unit}`;

export function ScannerView({ locale, addEntry, notify, today }: Props) {
  const t = translations[locale];
  const videoRef = useRef<HTMLVideoElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);
  const [grams, setGrams] = useState(100);
  const [adding, setAdding] = useState(false);
  const [manualName, setManualName] = useState("");
  const [manualKcal, setManualKcal] = useState("");
  const [manualProtein, setManualProtein] = useState("");
  const [manualCarbs, setManualCarbs] = useState("");
  const [manualFat, setManualFat] = useState("");
  const [manualGrams, setManualGrams] = useState("100");

  const lookup = useCallback(async (code: string) => {
    const digits = code.trim();
    if (!/^\d{6,14}$/.test(digits)) { notify(t.barcodeInvalid, true); return; }
    setBarcode(digits); setLoading(true); setProduct(null);
    try {
      const response = await fetch(`/api/products/${encodeURIComponent(digits)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? t.notFound : payload.error || t.networkError);
      setProduct(payload.product as Product);
      setGrams(100);
    } catch (error) { notify(error instanceof Error ? error.message : t.networkError, true); }
    finally { setLoading(false); }
  }, [notify, t.barcodeInvalid, t.notFound, t.networkError]);

  useEffect(() => {
    if (!scanning) return;
    let stopped = false;
    let controls: { stop: () => void } | null = null;
    const start = async () => {
      try {
        const { BrowserMultiFormatReader } = await import("@zxing/browser");
        const reader = new BrowserMultiFormatReader();
        if (!videoRef.current || stopped) return;
        controls = await reader.decodeFromVideoDevice(undefined, videoRef.current, (result) => {
          if (!result || stopped) return;
          stopped = true;
          if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate(80);
          controls?.stop();
          setScanning(false);
          void lookup(result.getText());
        });
        if (stopped) controls?.stop();
      } catch {
        if (!stopped) { setScanning(false); notify(t.cameraHint, true); }
      }
    };
    void start();
    return () => { stopped = true; controls?.stop(); };
  }, [scanning, lookup, notify, t.cameraHint]);

  const scanPhoto = async (file?: File) => {
    if (!file) return;
    const url = URL.createObjectURL(file);
    try {
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      const result = await reader.decodeFromImageUrl(url);
      await lookup(result.getText());
    } catch { notify(t.notFound, true); }
    finally { URL.revokeObjectURL(url); if (fileRef.current) fileRef.current.value = ""; }
  };

  const addScanned = async () => {
    if (!product || product.kcal100 === null || !Number.isFinite(grams) || grams <= 0 || grams > 10000) return;
    setAdding(true);
    try {
      await addEntry({ date: today, name: product.name, barcode: product.barcode, grams,
        kcal: scale(product.kcal100, grams)!, protein: scale(product.protein100, grams),
        carbs: scale(product.carbs100, grams), fat: scale(product.fat100, grams),
        image: product.image, source: "off" });
      notify(t.added); setProduct(null);
    } catch (e) { notify(e instanceof Error ? e.message : t.genericError, true); }
    finally { setAdding(false); }
  };

  const addCustom = async () => {
    const kcal = Number(manualKcal), portion = Number(manualGrams);
    if (!manualName.trim() || manualKcal.trim() === "" || !Number.isFinite(kcal) || kcal < 0 || kcal > 1000 ||
        !Number.isFinite(portion) || portion <= 0 || portion > 10000) { notify(t.enterName, true); return; }
    const optionalVal = (v: string): number | null => {
      if (v.trim() === "") return null;
      const n = Number(v); return Number.isFinite(n) && n >= 0 && n <= 100 ? n : NaN;
    };
    const p = optionalVal(manualProtein), c = optionalVal(manualCarbs), f = optionalVal(manualFat);
    if ([p, c, f].some(v => Number.isNaN(v))) { notify(t.formError, true); return; }
    setAdding(true);
    try {
      await addEntry({ date: today, name: manualName.trim(), barcode: null, grams: portion,
        kcal: scale(kcal, portion)!, protein: scale(p, portion), carbs: scale(c, portion), fat: scale(f, portion),
        image: null, source: "manual" });
      setManualName(""); setManualKcal(""); setManualProtein(""); setManualCarbs(""); setManualFat("");
      notify(t.added);
    } catch (e) { notify(e instanceof Error ? e.message : t.genericError, true); }
    finally { setAdding(false); }
  };

  return <div className="view fade-in">
    <div className="view-header"><div><span className="eyebrow"><ScanLine size={14} /> KALO SCAN</span>
      <h1>{t.scanTitle}</h1><p>{t.scanSub}</p></div><span className="header-illustration"><Barcode size={52} strokeWidth={1.1}/></span></div>
    <div className="scanner-grid">
      <div className="card scan-main">
        <div className="card-title"><div className="icon-badge olive"><Camera size={19}/></div><div><h2>{t.camera}</h2><p>{t.cameraIntro}</p></div></div>
        <div className={`camera-stage ${scanning ? "camera-active" : ""}`}>
          {scanning ? <video ref={videoRef} muted playsInline autoPlay className="camera-video" />
            : <div className="camera-idle"><ScanLine size={55} strokeWidth={1.2}/><p>EAN • UPC</p></div>}
          <div className="scanner-corners"><span/><span/><span/><span/></div>
          {scanning && <div className="scanner-beam"/>}
        </div>
        <div className="camera-buttons">
          <button type="button" className={`btn ${scanning ? "btn-outline" : "btn-primary"}`} onClick={() => setScanning(x => !x)}>
            {scanning ? <CameraOff size={18}/> : <Camera size={18}/>} {scanning ? t.stopCam : t.startCam}
          </button>
          <button type="button" className="btn btn-outline" onClick={() => fileRef.current?.click()}><Upload size={17}/>{t.uploadPhoto}</button>
          <input ref={fileRef} type="file" accept="image/*" className="visually-hidden" aria-label={t.uploadPhoto}
            onChange={e => void scanPhoto(e.target.files?.[0])}/>
        </div>
        <p className="subtle-note"><Info size={14}/>{t.cameraHint}</p>
        <div className="separator-label"><span>{t.enterBarcode}</span></div>
        <form className="barcode-form" onSubmit={e => { e.preventDefault(); void lookup(barcode); }}>
          <div className="input-with-icon"><Barcode size={18}/><input value={barcode} onChange={e => setBarcode(e.target.value.replace(/\D/g, "").slice(0, 14))} inputMode="numeric" placeholder={t.barcodePlaceholder} aria-label={t.enterBarcode}/></div>
          <button className="btn btn-primary" type="submit" disabled={loading}>{loading ? <LoaderCircle className="spin" size={18}/> : <Search size={17}/>}<span>{t.findProduct}</span></button>
        </form>
      </div>
      <aside className="scanner-side">
        <div className="sidebar-feature"><div className="sidebar-feature-symbol"><Package size={34}/></div><span className="eyebrow">KALO</span><h3>{t.foundProduct}</h3><p>{t.sourceCaveat}</p><a href="https://world.openfoodfacts.org" target="_blank" rel="noreferrer">Open Food Facts <ChevronRight size={16}/></a></div>
        <div className="card tip-card"><Info size={20}/><p>{t.disclaimer}</p></div>
      </aside>
    </div>

    {loading && <div className="card state-panel"><LoaderCircle size={30} className="spin"/><p>{t.searchLoading}</p></div>}
    {product && !loading && <div className="card product-card fade-in" id="product-results">
      <div className="card-section-top"><div><span className="eyebrow"><Check size={14}/>{t.foundProduct}</span><h2>{product.name}</h2><p>{[product.brand, product.quantity, product.barcode].filter(Boolean).join(" • ")}</p></div>
        {product.nutriscore && <span className={`nutriscore nutri-${product.nutriscore.toLowerCase()}`}>Nutri-Score {product.nutriscore.toUpperCase()}</span>}</div>
      <div className="product-content">
        <div className="product-photo">{product.image ? <img src={product.image} alt={product.name} referrerPolicy="no-referrer" /> : <Package size={64} strokeWidth={1.2}/>}</div>
        <div className="product-details">
          <p className="mini-heading">{t.nutrition100}</p>
          <div className="nutrition-grid">
            <div className="nutrition-major"><span>{t.kcal}</span><strong>{show(product.kcal100, "")}</strong></div>
            <div><span>{t.protein}</span><strong>{show(product.protein100)}</strong></div>
            <div><span>{t.carbs}</span><strong>{show(product.carbs100)}</strong></div>
            <div><span>{t.fat}</span><strong>{show(product.fat100)}</strong></div>
            <div><span>{t.sugar}</span><strong>{show(product.sugar100)}</strong></div>
            <div><span>{t.salt}</span><strong>{show(product.salt100)}</strong></div>
            <div><span>{t.fiber}</span><strong>{show(product.fiber100)}</strong></div>
            <div><span>{t.nova}</span><strong>{product.nova ?? "—"}</strong></div>
          </div>
          <div className="portion-entry"><div><label htmlFor="scan-grams">{t.portion} ({t.grams})</label>
              <input id="scan-grams" type="number" min="1" max="10000" value={grams} onChange={e => setGrams(Number(e.target.value))}/></div>
            <div className="portion-total"><span>{t.perPortion}</span><strong>{show(scale(product.kcal100, grams), t.kcal)}</strong></div>
            <button className="btn btn-primary" onClick={() => void addScanned()} type="button" disabled={adding || product.kcal100 === null || grams <= 0 || grams > 10000}><Plus size={18}/>{t.addToDiary}</button>
          </div>
          {product.kcal100 === null && <p className="error-inline">{t.noEnergy}</p>}
        </div>
      </div>
      <div className="product-footnotes">
        {product.ingredients && <p><strong>{t.ingredients}:</strong> {product.ingredients}</p>}
        <p><strong>{t.allergens}:</strong> {product.allergens.length ? product.allergens.map(a => a.replace(/^[a-z]{2}:/, "").replaceAll("-", " ")).join(", ") : t.unavailable}</p>
        <p className="subtle-note"><Info size={14}/><span><a href={`https://world.openfoodfacts.org/product/${product.barcode}`} target="_blank" rel="noopener noreferrer" className="source-link">{t.source}</a> · {t.sourceCaveat}</span></p>
      </div>
    </div>}
    <div className="card manual-card">
      <div className="card-title"><div className="icon-badge peach"><Plus size={19}/></div><div><h2>{t.manualTitle}</h2><p>{t.manualSub}</p></div></div>
      <form onSubmit={e => { e.preventDefault(); void addCustom(); }} className="manual-form">
        <div className="field wide"><label htmlFor="manual-name">{t.manualName}</label><input id="manual-name" value={manualName} onChange={e => setManualName(e.target.value)} maxLength={180} placeholder={t.manualName}/></div>
        <div className="field"><label htmlFor="manual-kcal">{t.manualCalories}</label><input id="manual-kcal" type="number" min="0" max="1000" step="0.1" value={manualKcal} onChange={e => setManualKcal(e.target.value)} placeholder="120"/></div>
        <div className="field"><label htmlFor="manual-grams">{t.portion} ({t.grams})</label><input id="manual-grams" type="number" min="1" max="10000" value={manualGrams} onChange={e => setManualGrams(e.target.value)}/></div>
        {([[t.protein,manualProtein,setManualProtein], [t.carbs,manualCarbs,setManualCarbs], [t.fat,manualFat,setManualFat]] as [string,string,(x:string)=>void][]).map(([label,val,set]) =>
          <div className="field" key={label}><label>{label} /100g <small>({t.optional})</small></label><input type="number" min="0" max="100" step="0.1" value={val} onChange={e => set(e.target.value)} placeholder="—"/></div>)}
        <button type="submit" disabled={adding} className="btn btn-primary manual-submit"><Plus size={17}/>{t.addManual}</button>
      </form>
    </div>
  </div>;
}
