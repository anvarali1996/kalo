"use client";

import { useState } from "react";
import { Barcode, Sparkles } from "lucide-react";
import type { DiaryItem, Locale, SessionUser } from "@/lib/types";
import { translations } from "@/lib/i18n";
import { ScannerView } from "./scanner";
import { AiFoodScanner } from "./ai-food-scanner";

interface Props {
  locale: Locale;
  initialTab: "barcode" | "photo";
  user: SessionUser | null;
  today: string;
  addEntry: (entry: Omit<DiaryItem, "id">) => Promise<void>;
  onEntriesAdded: (entries: DiaryItem[]) => void;
  openAuth: () => void;
  notify: (text: string, error?: boolean) => void;
}

export function ScannerHub(props: Props) {
  const [tab, setTab] = useState(props.initialTab);
  const t = translations[props.locale];
  return <>
    <div className="scanner-tabs" role="tablist" aria-label={t.navScan}>
      <button type="button" id="barcode-tab" role="tab" aria-selected={tab === "barcode"} aria-controls="scanner-panel" className={tab === "barcode" ? "active" : ""} onClick={() => setTab("barcode")}><Barcode size={18}/>{t.barcodeTab}</button>
      <button type="button" id="photo-tab" role="tab" aria-selected={tab === "photo"} aria-controls="scanner-panel" className={tab === "photo" ? "active" : ""} onClick={() => setTab("photo")}><Sparkles size={18}/>{t.photoTab}</button>
    </div>
    <div id="scanner-panel" role="tabpanel" aria-labelledby={tab === "barcode" ? "barcode-tab" : "photo-tab"}>
      {tab === "barcode" ? <ScannerView locale={props.locale} addEntry={props.addEntry} notify={props.notify} today={props.today}/>
        : <AiFoodScanner key={props.user?.id || "guest"} locale={props.locale} user={props.user} today={props.today} openAuth={props.openAuth} onEntriesAdded={props.onEntriesAdded} notify={props.notify}/>}
    </div>
  </>;
}
