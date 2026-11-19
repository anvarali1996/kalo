"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Globe2, LoaderCircle, RefreshCw, Search } from "lucide-react";
import type { AdminUsersResponse } from "@/lib/admin-types";
import { intlLocale, localeNames, translations } from "@/lib/i18n";
import { monitorSession } from "@/lib/session-client";
import type { Locale } from "@/lib/types";

export function AdminPanel({ viewerId }: { viewerId: string }) {
  const [locale, setLocale] = useState<Locale>("uz");
  const [draft, setDraft] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<AdminUsersResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const t = translations[locale];
  const formatDate = new Intl.DateTimeFormat(intlLocale[locale], { dateStyle: "medium", timeStyle: "short" });
  const formatNumber = new Intl.NumberFormat(intlLocale[locale]);

  const leave = useCallback(() => {
    setData(null);
    window.location.replace("/");
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("kalo_locale");
      if (saved === "uz" || saved === "en" || saved === "ru" || saved === "lv") setLocale(saved);
    } catch { /* The default language works without storage. */ }
  }, []);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  useEffect(() => monitorSession(user => {
    if (user?.id !== viewerId || !user.isAdmin) leave();
  }), [viewerId, leave]);

  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setFailed(false);
      const params = new URLSearchParams({ page: String(page), search });
      try {
        const response = await fetch(`/api/admin/users?${params}`, {
          cache: "no-store", credentials: "same-origin", signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        if (response.status === 401 || response.status === 403) { leave(); return; }
        if (!response.ok) throw new Error("Failed to load users");
        const result: AdminUsersResponse = await response.json();
        if (!controller.signal.aborted) setData(result);
      } catch {
        if (!controller.signal.aborted) { setData(null); setFailed(true); }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [page, search, revision, leave]);

  const updateLanguage = (next: Locale) => {
    setLocale(next);
    try { localStorage.setItem("kalo_locale", next); }
    catch { /* Language remains active for the current page. */ }
  };

  return (
    <main className="admin-main">
      <div className="admin-tools">
        <Link href="/" className="btn btn-outline"><ArrowLeft size={17}/>{t.adminBack}</Link>
        <div className="language-select">
          <Globe2 size={17}/>
          <select aria-label={t.language} value={locale} onChange={event => updateLanguage(event.target.value as Locale)}>
            {(Object.keys(localeNames) as Locale[]).map(key => <option key={key} value={key}>{localeNames[key]}</option>)}
          </select>
        </div>
      </div>
      <div className="view-header"><h1>{t.adminTitle}</h1></div>

      {data && <section className="card admin-card">
        <div className="panel-heading"><h2>{t.adminScannerSetup}</h2></div>
        <dl className="admin-setup">
          {([
            [t.adminDatabase, data.scannerSetup.database],
            [t.adminOpenAi, data.scannerSetup.openAi],
            [t.adminStripe, data.scannerSetup.stripe],
          ] as const).map(([label, configured]) => <div key={label}>
            <dt>{label}</dt>
            <dd className={configured ? "admin-ready" : "admin-pending"}>
              {configured ? t.adminConfigured : t.adminNeedsSetup}
            </dd>
          </div>)}
        </dl>
        {!data.scannerSetup.database && <p className="ai-no-credits">{t.adminMigrationHint}</p>}
      </section>}

      <section className="card admin-card" aria-busy={loading}>
        <div className="panel-heading admin-list-heading">
          <div><h2>{t.adminUsers}</h2>{data && <p>{formatNumber.format(data.total)}</p>}</div>
          <button className="btn btn-outline" type="button" disabled={loading} onClick={() => setRevision(value => value + 1)}>
            <RefreshCw size={16}/>{t.aiRefresh}
          </button>
        </div>
        <form className="admin-search" onSubmit={event => {
          event.preventDefault();
          setPage(1);
          setSearch(draft.trim());
          setRevision(value => value + 1);
        }}>
          <div className="field">
            <label htmlFor="admin-search">{t.adminSearch}</label>
            <input id="admin-search" type="search" maxLength={180} value={draft} onChange={event => setDraft(event.target.value)}/>
          </div>
          <button className="btn btn-primary" type="submit"><Search size={16}/>{t.adminSearchButton}</button>
        </form>
        {loading && <div className="admin-loading" role="status" aria-label={t.adminUsers}><LoaderCircle size={22} className="spin"/></div>}
        {failed && <p className="form-error" role="alert">{t.adminUnavailable}</p>}
        {!loading && data?.users.length === 0 && <p className="admin-empty">{t.adminNoUsers}</p>}
        {data && data.users.length > 0 && <ul className="admin-user-list">
          {data.users.map(user => <li key={user.id} className="admin-user">
            <div className="admin-user-name"><strong>{user.name}</strong><span>{user.email}</span></div>
            <dl>
              <div><dt>{t.adminRegistered}</dt><dd>{formatDate.format(new Date(user.createdAt))}</dd></div>
              <div><dt>{t.adminSession}</dt><dd>{user.sessionStartedAt ? formatDate.format(new Date(user.sessionStartedAt)) : t.adminNoSession}</dd></div>
              <div><dt>{t.aiCredits}</dt><dd>{user.scanCredits === null ? "—" : formatNumber.format(user.scanCredits)}</dd></div>
            </dl>
          </li>)}
        </ul>}
        {data && (page > 1 || data.hasMore) && <div className="ai-history-pages">
          <button className="btn btn-outline" type="button" disabled={loading || page === 1} onClick={() => setPage(value => value - 1)}>
            <ChevronLeft size={16}/>{t.adminPrevious}
          </button>
          <span>{formatNumber.format(page)}</span>
          <button className="btn btn-outline" type="button" disabled={loading || !data.hasMore} onClick={() => setPage(value => value + 1)}>
            {t.adminNext}<ChevronRight size={16}/>
          </button>
        </div>}
      </section>
    </main>
  );
}
