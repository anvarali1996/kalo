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
    const register = () => {
      void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch((error) => {
        console.warn("KALO service worker registration failed", error);
      });
    };
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
  return null;
}

export function PwaInstallBanner({ locale }: { locale: Locale }) {
  const t = translations[locale];
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [show, setShow] = useState(false);
  const [ios, setIos] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const appleMobile = /iPhone|iPad|iPod/i.test(navigator.userAgent);
    setIos(appleMobile);
    setInstalled(standalone);
    setDismissed(localStorage.getItem("kalo_hide_install") === "1");
    setShow(window.matchMedia("(max-width: 900px)").matches);

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      setShow(true);
    };
    const onInstalled = () => { setInstalled(true); setPromptEvent(null); };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = async () => {
    if (!promptEvent) return;
    try {
      await promptEvent.prompt();
      const choice = await promptEvent.userChoice;
      if (choice.outcome === "accepted") setInstalled(true);
    } catch { /* Browser will retain its own installation instructions. */ }
    finally { setPromptEvent(null); }
  };
  const dismiss = () => {
    localStorage.setItem("kalo_hide_install", "1");
    setDismissed(true);
  };
  if (!show || dismissed || installed) return null;

  return (
    <div className="pwa-banner" role="region" aria-label={t.pwaTitle}>
      <span className="pwa-banner-icon"><Smartphone size={23}/></span>
      <div className="pwa-banner-copy">
        <strong>{t.pwaTitle}</strong>
        <p>{promptEvent ? t.pwaDescription : ios ? t.pwaIOSHint : t.pwaBrowserHint}</p>
      </div>
      {promptEvent ? <button type="button" className="btn btn-primary pwa-banner-action" onClick={() => void install()}><Download size={16}/>{t.pwaInstall}</button>
        : <span className="pwa-hint-icon" title={t.pwaDescription}><Info size={19}/></span>}
      <button type="button" className="pwa-dismiss" onClick={dismiss} aria-label={t.pwaDismiss}><X size={18}/></button>
    </div>
  );
}
