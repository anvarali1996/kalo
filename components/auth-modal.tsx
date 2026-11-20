"use client";

import { useEffect, useState } from "react";
import { Eye, EyeOff, Info, LoaderCircle, LogIn, X } from "lucide-react";
import { appName } from "@/lib/brand";
import { scanApi } from "@/lib/client-api";
import { translations } from "@/lib/i18n";
import { credentialsSchema, signupFormSchema } from "@/lib/validations";
import type { Locale } from "@/lib/types";
import { BrandMark } from "./brand-mark";

export type AuthMode = "signup" | "login" | "forgot";

interface Props {
  mode: AuthMode;
  setMode: (value: AuthMode | null) => void;
  locale: Locale;
  dbConfigured: boolean;
  submit: (mode: "signup" | "login", input: { name: string; email: string; password: string }) => Promise<void>;
}

export function AuthModal({ mode, setMode, locale, dbConfigured, submit }: Props) {
  const t = translations[locale];
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [linkSent, setLinkSent] = useState(false);
  const forgot = mode === "forgot";
  const title = forgot ? t.passwordResetTitle : mode === "signup" ? t.signupTitle : t.loginTitle;

  const switchMode = (next: AuthMode) => {
    setError(""); setMismatch(false); setLinkSent(false); setPassword("");
    setConfirmPassword(""); setShowPassword(false); setMode(next);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape" && !busy) setMode(null); };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [setMode, busy]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault(); setError(""); setMismatch(false);
    if (busy) return;
    if (mode === "forgot") {
      setBusy(true);
      try {
        await scanApi("/api/auth/forgot-password", locale, { email, locale });
        setLinkSent(true);
      } catch (error) { setError(error instanceof Error ? error.message : t.passwordServiceUnavailable); }
      finally { setBusy(false); }
      return;
    }
    const parsed = mode === "signup" ? signupFormSchema.safeParse({ name, email, password, confirmPassword })
      : credentialsSchema.safeParse({ email, password });
    if (!parsed.success) {
      const passwordsDiffer = parsed.error.issues.some(issue => issue.path[0] === "confirmPassword");
      setMismatch(passwordsDiffer);
      setError(passwordsDiffer ? t.passwordMismatch : t.formError);
      return;
    }
    setBusy(true);
    try {
      // The form-only confirmation field never crosses this boundary.
      await submit(mode, { name, email: parsed.data.email, password: parsed.data.password });
    } catch (e) { setError(e instanceof Error ? e.message : t.genericError); }
    finally { setBusy(false); }
  };

  return <div className="modal-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) setMode(null); }}>
    <div className="auth-modal" role="dialog" aria-modal="true" aria-label={title}>
      <button className="modal-close" disabled={busy} onClick={() => setMode(null)} aria-label={t.close}><X size={20}/></button>
      <div className="auth-brand"><BrandMark/><strong>{appName}</strong></div>
      <h2>{title}</h2><p>{forgot ? t.passwordResetPrompt : t.accountSub}</p>
      {!dbConfigured && <div className="auth-warning"><Info size={17}/>{t.dbMissing}</div>}
      {linkSent && forgot ? <p className="password-link-sent" role="status">{t.passwordResetSent}</p>
        : <form onSubmit={e => void onSubmit(e)} className="auth-form">
        {mode === "signup" && <div className="field"><label htmlFor="auth-name">{t.name}</label>
          <input id="auth-name" autoComplete="name" value={name} minLength={2} maxLength={100} required disabled={busy} onChange={e => setName(e.target.value)}/></div>}
        <div className="field"><label htmlFor="auth-email">{t.email}</label><input id="auth-email" type="email" autoComplete="email" value={email} maxLength={254} required disabled={busy} onChange={e => setEmail(e.target.value)}/></div>
        {!forgot && <><div className="field"><label htmlFor="auth-password">{t.password}</label><input id="auth-password" type={showPassword ? "text" : "password"} autoComplete={mode === "signup" ? "new-password" : "current-password"} minLength={8} maxLength={72} value={password} required disabled={busy} onChange={e => { setPassword(e.target.value); setError(""); setMismatch(false); }} placeholder={t.minPassword}/></div>
        {mode === "signup" && <div className="field"><label htmlFor="auth-confirm-password">{t.confirmPassword}</label>
          <input id="auth-confirm-password" type={showPassword ? "text" : "password"} autoComplete="new-password" maxLength={72} value={confirmPassword} required disabled={busy}
            aria-invalid={mismatch} aria-describedby={error ? "auth-error" : undefined}
            onChange={e => { setConfirmPassword(e.target.value); setError(""); setMismatch(false); }}/></div>}
        <button type="button" className="password-toggle" aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>
          {showPassword ? <EyeOff size={17}/> : <Eye size={17}/>} {showPassword ? t.hidePassword : t.showPassword}
        </button>
        </>}
        {error && <div className="form-error" id="auth-error" role="alert">{error}</div>}
        <button type="submit" disabled={busy || !dbConfigured} className="btn btn-primary auth-submit">
          {busy ? <LoaderCircle className="spin" size={18}/> : <LogIn size={18}/>} {forgot ? t.passwordSendLink : mode === "signup" ? t.submitSignup : t.submitLogin}
        </button>
      </form>}
      {mode === "login" && <button className="switch-auth" disabled={busy} onClick={() => switchMode("forgot")}>{t.forgotPassword}</button>}
      <button className="switch-auth" disabled={busy} onClick={() => switchMode(mode === "login" ? "signup" : "login")}>
        {forgot ? t.login : mode === "signup" ? t.switchLogin : t.switchSignup}
      </button>
    </div>
  </div>;
}
