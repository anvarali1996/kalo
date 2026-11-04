// "use client";

// import { useEffect, useState } from "react";
// import { Download, Info, Smartphone, X } from "lucide-react";
// import type { Locale } from "@/lib/types";
// import { translations } from "@/lib/i18n";

// interface InstallPromptEvent extends Event {
//   prompt: () => Promise<void>;
//   userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
// }
// export function PwaRegistration() {
//   useEffect(() => {
//     if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
//     const register = () => { void navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(console.warn); };
//     if (document.readyState === "complete") register();
//     else { window.addEventListener("load", register, { once: true }); return () => window.removeEventListener("load", register); }
//   }, []);
//   return null;
// }
// export function PwaInstallBanner({ locale }: { locale: Locale }) {
//   const t = translations[locale];
//   const [promptEvent, setPromptEvent] = useState<InstallPromptEvent | null>(null);
//   const [ready, setReady] = useState(false);
//   const [showInstructions, setShowInstructions] = useState(false);
//   const [ios, setIos] = useState(false);
//   const [macSafari, setMacSafari] = useState(false);
//   const [dismissed, setDismissed] = useState(false);
//   const [installed, setInstalled] = useState(false);
//   useEffect(() => {
//     const standalone = window.matchMedia("(display-mode: standalone)").matches ||
//       Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
//     setIos(/iPhone|iPad|iPod/i.test(navigator.userAgent));
//     setMacSafari(/Macintosh/i.test(navigator.userAgent) && /Safari/i.test(navigator.userAgent) && !/Chrome|Chromium|Edg/i.test(navigator.userAgent));
//     setInstalled(standalone);
//     setDismissed(localStorage.getItem("kalo_hide_install") === "1");
//     setShow(window.matchMedia("(max-width: 900px)").matches);
//     const onPrompt = (event: Event) => { event.preventDefault(); setPromptEvent(event as InstallPromptEvent); setShow(true); };
//     const onInstalled = () => { setInstalled(true); setPromptEvent(null); };
//     window.addEventListener("beforeinstallprompt", onPrompt);
//     window.addEventListener("appinstalled", onInstalled);
//     return () => { window.removeEventListener("beforeinstallprompt", onPrompt); window.removeEventListener("appinstalled", onInstalled); };
//   }, []);
//   const install = async () => {
//     if (!promptEvent) return;
//     try { await promptEvent.prompt(); const choice = await promptEvent.userChoice; if (choice.outcome === "accepted") setInstalled(true); }
//     catch { /* Browser install prompt is optional. */ }
//     finally { setPromptEvent(null); }
//   };
//   if (!ready || dismissed || installed) return null;
//   const instructions = ios ? t.pwaIOSHint : macSafari ? t.pwaMacSafariHint : t.pwaBrowserHint;
//   return <div className="pwa-banner" role="region" aria-label={t.pwaTitle}>
//     <span className="pwa-banner-icon"><Smartphone size={23}/></span>
//     <div className="pwa-banner-copy"><strong>{t.pwaTitle}</strong><p>{!promptEvent && showInstructions ? instructions : t.pwaDescription}</p></div>
//     {promptEvent ? <button className="btn btn-primary pwa-banner-action" type="button" onClick={() => void install()}><Download size={16}/>{t.pwaInstall}</button>
//       : <button className="btn btn-outline pwa-banner-action" type="button" aria-expanded={showInstructions} onClick={() => setShowInstructions(x => !x)}><Info size={16}/>{t.pwaHowTo}</button>}
//     <button className="pwa-dismiss" type="button" aria-label={t.pwaDismiss} onClick={() => {sessionStorage.setItem("kalo_hide_install", "1");setDismissed(true);}}><X size={18}/></button>
//   </div>;
// }
// }


"use client";

import { useEffect, useState } from "react";
import { Download, Info, Smartphone, X } from "lucide-react";
import type { Locale } from "@/lib/types";
import { translations } from "@/lib/i18n";

// Browser PWA install event
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{
    outcome: "accepted" | "dismissed";
    platform: string;
  }>;
}

type DeviceType = "ios" | "macSafari" | "other";

// Local translations to avoid missing i18n keys
const installHelp: Record<Locale, string> = {
  uz: "Qanday o‘rnatiladi?",
  en: "How to install",
  ru: "Как установить?",
  lv: "Kā uzstādīt?",
};

const macSafariHelp: Record<Locale, string> = {
  uz: "Mac Safari brauzerida File → Add to Dock ni tanlang.",
  en: "In Safari on Mac, choose File → Add to Dock.",
  ru: "В Safari на Mac выберите Файл → Добавить в Dock.",
  lv: "Mac Safari pārlūkā izvēlies File → Add to Dock.",
};

// Register service worker
export function PwaRegistration() {
  useEffect(() => {
    if (
      !("serviceWorker" in navigator) ||
      !window.isSecureContext
    ) {
      return;
    }

    const registerServiceWorker = () => {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .catch((error) => {
          console.error("KALO PWA registration error:", error);
        });
    };

    if (document.readyState === "complete") {
      registerServiceWorker();
    } else {
      window.addEventListener("load", registerServiceWorker);

      return () => {
        window.removeEventListener("load", registerServiceWorker);
      };
    }
  }, []);

  return null;
}

// Install banner
export function PwaInstallBanner({
  locale,
}: {
  locale: Locale;
}) {
  const t = translations[locale];

  const [promptEvent, setPromptEvent] =
    useState<InstallPromptEvent | null>(null);

  const [ready, setReady] = useState(false);
  const [showInstructions, setShowInstructions] = useState(false);
  const [device, setDevice] = useState<DeviceType>("other");
  const [dismissed, setDismissed] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    const userAgent = navigator.userAgent;

    // Check whether PWA is already installed
    const standalone =
      window.matchMedia("(display-mode: standalone)").matches ||
      Boolean(
        (navigator as Navigator & { standalone?: boolean }).standalone
      );

    setInstalled(standalone);

    // Detect iPhone and iPad
    const isIOS =
      /iPhone|iPad|iPod/i.test(userAgent) ||
      (navigator.platform === "MacIntel" &&
        navigator.maxTouchPoints > 1);

    // Detect Safari on Mac
    const isMacSafari =
      !isIOS &&
      /Macintosh/i.test(userAgent) &&
      /Safari/i.test(userAgent) &&
      !/Chrome|Chromium|CriOS|Edg|OPR/i.test(userAgent);

    if (isIOS) {
      setDevice("ios");
    } else if (isMacSafari) {
      setDevice("macSafari");
    } else {
      setDevice("other");
    }

    // Hide only for the current browser tab/session
    try {
      setDismissed(
        sessionStorage.getItem("kalo_hide_install") === "1"
      );
    } catch {
      setDismissed(false);
    }

    setReady(true);

    // Chrome / Edge install prompt
    const handleBeforeInstall = (event: Event) => {
      event.preventDefault();
      setPromptEvent(event as InstallPromptEvent);
      setShowInstructions(false);
    };

    // Detect successful installation
    const handleInstalled = () => {
      setInstalled(true);
      setPromptEvent(null);
    };

    window.addEventListener(
      "beforeinstallprompt",
      handleBeforeInstall
    );

    window.addEventListener("appinstalled", handleInstalled);

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        handleBeforeInstall
      );

      window.removeEventListener(
        "appinstalled",
        handleInstalled
      );
    };
  }, []);

  // Open native installation dialog
  const handleInstall = async () => {
    if (!promptEvent) {
      setShowInstructions(true);
      return;
    }

    try {
      await promptEvent.prompt();

      const choice = await promptEvent.userChoice;

      if (choice.outcome === "accepted") {
        setDismissed(true);
      }
    } catch (error) {
      console.error("KALO installation error:", error);
      setShowInstructions(true);
    } finally {
      setPromptEvent(null);
    }
  };

  // Dismiss the install banner
  const handleDismiss = () => {
    try {
      sessionStorage.setItem("kalo_hide_install", "1");
    } catch {
      // Storage might be disabled
    }

    setDismissed(true);
  };

  // Hide after successful installation or dismissal
  if (!ready || installed || dismissed) {
    return null;
  }

  // Device-specific instructions
  const instructions =
    device === "ios"
      ? t.pwaIOSHint
      : device === "macSafari"
        ? macSafariHelp[locale]
        : t.pwaBrowserHint;

  return (
    <div
      className="pwa-banner"
      role="region"
      aria-label={t.pwaTitle}
    >
      <span className="pwa-banner-icon">
        <Smartphone size={23} />
      </span>

      <div className="pwa-banner-copy">
        <strong>{t.pwaTitle}</strong>

        <p>
          {!promptEvent && showInstructions
            ? instructions
            : t.pwaDescription}
        </p>
      </div>

      {promptEvent ? (
        <button
          type="button"
          className="btn btn-primary pwa-banner-action"
          onClick={() => void handleInstall()}
        >
          <Download size={16} />
          {t.pwaInstall}
        </button>
      ) : (
        <button
          type="button"
          className="btn btn-outline pwa-banner-action"
          aria-expanded={showInstructions}
          onClick={() => {
            setShowInstructions((previous) => !previous);
          }}
        >
          <Info size={16} />
          {installHelp[locale]}
        </button>
      )}

      <button
        type="button"
        className="pwa-dismiss"
        aria-label={t.pwaDismiss}
        onClick={handleDismiss}
      >
        <X size={18} />
      </button>
    </div>
  );
}
