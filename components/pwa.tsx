"use client";

import { useEffect, useState } from "react";
import { Download, Info, Smartphone, X } from "lucide-react";
import type { Locale } from "@/lib/types";
import { translations } from "@/lib/i18n";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}
export function PwaRegistration() {
  useEffect(() => {
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    const register = () => { void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(console.warn); };
    if (document.readyState === "complete") register();
    else { window.addEventListener("load", register, { once: true }); return () => window.removeEventListener("load", register); }
  }, []);
  return null;
}
export function PwaInstallBanner({ locale }: { locale: Locale }) {
  const t = translations[locale];
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [ready, setReady] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [ios, setIos] = useState(false);
  const [macSafari, setMacSafari] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);
  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent));
    setMacSafari(/Macintosh/i.test(navigator.userAgent) && /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg/i.test(navigator.userAgent));
    setInstalled(standalone);
    setDismissed(localStorage.getItem("kalo_hide_install") === "1");
    setShow(window.matchMedia("(max-width: 900px)").matches);
    const onPrompt = (event: Event) => { event.preventDefault(); setPromptEvent(event as InstallPromptEvent); setShow(true); };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
  }, []);
  const install = async () => {
    if (!promptEvent) return;
    try { await promptEvent.prompt(); const choice = await promptEvent.userChoice; if (choice.outcome === "accepted") setInstalled(true); }
    catch { /* Browser install prompt is optional. */ }
    finally { setPromptEvent(null); }
  };
  if (!ready || dismissed || installed) return null;
  const instructions = ios ? t.pwaIOSHint : macSafari ? t.pwaMacSafariHint : t.pwaBrowserHint;
  return <div className="pwa-banner" role="region" aria-label={t.pwaTitle}>
    <span className="pwa-banner-icon"><Smartphone size={23}/></span>
    <div className="pwa-banner-copy"><strong>{t.pwaTitle}</strong><p>{!promptEvent && showInstructions ? instructions : t.pwaDescription}</p></div>
    {promptEvent ? <button className="btn btn-primary pwa-banner-action" type="button" onClick={() => void install()}><Download size={16}/>{t.pwaInstall}</button>
      : <button className="btn btn-outline pwa-banner-action" type="button" aria-expanded={showInstructions} onClick={() => setShowInstructions(x => !x)}><Info size={16}/>{t.pwaHowTo}</button>}
    <button className="pwa-dismiss" type="button" aria-label={t.pwaDismiss} onClick={() => {sessionStorage.setItem("kalo_hide_install", "1");setDismissed(true);}}><X size={18}/></button>
  </div>;
}
