"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { appName } from "@/lib/brand";
import { localeSchema } from "@/lib/ai-validation";
import { translations } from "@/lib/i18n";
import { resetTokenSchema } from "@/lib/validations";
import type { Locale } from "@/lib/types";
import { BrandMark } from "./brand-mark";
import { PasswordForm } from "./password-form";

export function ResetPasswordView() {
  const initialized = useRef(false);
  const [locale, setLocale] = useState<Locale>("uz");
  const [token, setToken] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    const params = new URLSearchParams(window.location.hash.slice(1));
    let savedLocale: string | null = null;
    try { savedLocale = localStorage.getItem("kalo_locale"); } catch { /* The email locale still works. */ }
    const language = localeSchema.safeParse(params.get("lang") ?? savedLocale);
    if (language.success) {
      setLocale(language.data);
      document.documentElement.lang = language.data;
      try { localStorage.setItem("kalo_locale", language.data); } catch { /* Optional preference. */ }
    }
    const input = resetTokenSchema.safeParse(params.get("token"));
    setToken(input.success ? input.data : "");
    if (window.location.hash) {
      window.history.replaceState(window.history.state, "", window.location.pathname + window.location.search);
    }
  }, []);

  const t = translations[locale];
  return <main className="password-reset-page">
    <section className="auth-modal password-reset-card" aria-labelledby="reset-heading">
      <div className="auth-brand"><BrandMark/><strong>{appName}</strong></div>
      <h1 id="reset-heading">{t.passwordResetTitle}</h1>
      {done ? <p role="status">{t.passwordResetSuccess}</p>
        : token === null ? <p role="status">{t.loadingDashboard}</p>
        : token ? <><p>{t.passwordResetHelp}</p><PasswordForm locale={locale} mode="reset" token={token}
          onSuccess={() => { setToken(""); setDone(true); }}/></>
        : <><p role="alert">{t.passwordResetTokenInvalid}</p><Link className="btn btn-primary" href="/?auth=forgot">{t.passwordSendLink}</Link></>}
      <Link className="switch-auth" href="/?auth=login">{t.login}</Link>
    </section>
  </main>;
}
