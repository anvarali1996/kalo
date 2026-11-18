"use client";

import { useEffect, useState } from "react";
import { Download, Info, Smartphone, X } from "lucide-react";
import type { Locale } from "@/lib/types";
import { translations } from "@/lib/i18n";

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

type Device = "ios" | "macSafari" | "other";
const dismissKey = "kalo_hide_install";

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

export function PwaInstallBanner({ locale, visible }: { locale: Locale; visible: boolean }) {
  const t = translations[locale];
  const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
  const [device, setDevice] = useState<Device | null>(null);
  const [showInstructions, setShowInstructions] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches ||
      Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
    const userAgent = navigator.userAgent;
    const ios = /iPhone|iPad|iPod/i.test(userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const macSafari = /Macintosh/i.test(userAgent) &&
      /Safari/i.test(userAgent) && !/Chrome|Chromium|CriOS|Edg|OPR/i.test(userAgent);

    setDevice(ios ? "ios" : macSafari ? "macSafari" : "other");
    setInstalled(standalone);
    setShowInstructions(window.matchMedia("(max-width: 900px)").matches);
    try {
      // Respect dismissals saved by the existing banner as well as this tab's preference.
      setDismissed(sessionStorage.getItem(dismissKey) === "1" || localStorage.getItem(dismissKey) === "1");
    } catch { /* Installation guidance is still available without storage. */ }

    const onPrompt = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
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
      else setShowInstructions(true);
    } catch {
      setShowInstructions(true);
    } finally {
      setPromptEvent(null);
    }
  };
  const dismiss = () => {
    try { sessionStorage.setItem(dismissKey, "1"); }
    catch { /* Hide the banner even when storage is disabled. */ }
    setDismissed(true);
  };
  if (!visible || !device || dismissed || installed) return null;

  const instructions = device === "ios" ? t.pwaIOSHint
    : device === "macSafari" ? t.pwaMacSafariHint
    : t.pwaBrowserHint;

  return (
    <div className="pwa-banner" role="region" aria-label={t.pwaTitle}>
      <span className="pwa-banner-icon"><Smartphone size={23}/></span>
      <div className="pwa-banner-copy">
        <strong>{t.pwaTitle}</strong>
        <p>{!promptEvent && showInstructions ? instructions : t.pwaDescription}</p>
      </div>
      {promptEvent ? (
        <button type="button" className="btn btn-primary pwa-banner-action" onClick={() => void install()}>
          <Download size={16}/>{t.pwaInstall}
        </button>
      ) : (
        <button type="button" className="btn btn-outline pwa-banner-action"
          aria-expanded={showInstructions} onClick={() => setShowInstructions(show => !show)}>
          <Info size={16}/>{t.pwaHowTo}
        </button>
      )}
      <button type="button" className="pwa-dismiss" onClick={dismiss} aria-label={t.pwaDismiss}><X size={18}/></button>
    </div>
  );
}
