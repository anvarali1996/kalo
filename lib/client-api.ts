import { translations, type TranslationKey } from "./i18n";
import type { Locale } from "./types";
import { requestSessionCheck } from "./session-client";

export class ScanApiError extends Error {
  constructor(public code: string, locale: Locale) {
    const t = translations[locale];
    super(Object.hasOwn(t, code) ? t[code as TranslationKey] : t.genericError);
  }
}

export async function scanApi<T>(url: string, locale: Locale, body?: object, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, { method: body ? "POST" : "GET", credentials: "same-origin", cache: "no-store", signal,
    headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
  if (response.status === 401) requestSessionCheck();
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new ScanApiError(typeof data.error === "string" ? data.error : "aiServiceError", locale);
  return data as T;
}
