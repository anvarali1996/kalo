"use client";

import { useId, useState } from "react";
import { Eye, EyeOff, KeyRound, LoaderCircle } from "lucide-react";
import { scanApi } from "@/lib/client-api";
import { translations } from "@/lib/i18n";
import { passwordConfirmationSchema } from "@/lib/validations";
import type { Locale } from "@/lib/types";

type Props = { locale: Locale; onSuccess: () => void } &
  ({ mode: "reset"; token: string } | { mode: "change" });

export function PasswordForm(props: Props) {
  const t = translations[props.locale];
  const id = useId();
  const [currentPassword, setCurrent] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmation] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const mismatch = error === t.passwordMismatch;
  const type = show ? "text" : "password";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    setError("");
    const input = passwordConfirmationSchema.safeParse({ password, confirmPassword });
    if (!input.success) {
      setError(input.error.issues.some(issue => issue.path[0] === "confirmPassword") ? t.passwordMismatch : t.formError);
      return;
    }
    setBusy(true);
    try {
      const reset = props.mode === "reset";
      await scanApi(reset ? "/api/auth/reset-password" : "/api/auth/change-password", props.locale, {
        ...input.data, ...(reset ? { token: props.token } : { currentPassword }),
      });
      setCurrent(""); setPassword(""); setConfirmation("");
      props.onSuccess();
    } catch (error) { setError(error instanceof Error ? error.message : t.passwordServiceUnavailable); }
    finally { setBusy(false); }
  };

  return <form className="auth-form" onSubmit={event => void submit(event)}>
    {props.mode === "change" && <div className="field">
      <label htmlFor={id + "-current"}>{t.passwordCurrent}</label>
      <input id={id + "-current"} type={type} autoComplete="current-password"
        value={currentPassword} onChange={event => setCurrent(event.target.value)} required minLength={8} maxLength={72} disabled={busy}/>
    </div>}
    <div className="field">
      <label htmlFor={id + "-new"}>{t.passwordNew}</label>
      <input id={id + "-new"} type={type} autoComplete="new-password"
        value={password} onChange={event => { setPassword(event.target.value); setError(""); }}
        placeholder={t.minPassword} required minLength={8} maxLength={72} disabled={busy}/>
    </div>
    <div className="field">
      <label htmlFor={id + "-confirmation"}>{t.confirmPassword}</label>
      <input id={id + "-confirmation"} type={type} autoComplete="new-password"
        value={confirmPassword} onChange={event => { setConfirmation(event.target.value); setError(""); }}
        aria-invalid={mismatch} aria-describedby={mismatch ? id + "-error" : undefined} required maxLength={72} disabled={busy}/>
    </div>
    <button type="button" className="password-toggle" aria-pressed={show} onClick={() => setShow(value => !value)}>
      {show ? <EyeOff size={17}/> : <Eye size={17}/>} {show ? t.hidePassword : t.showPassword}
    </button>
    {error && <p className="form-error" id={id + "-error"} role="alert">{error}</p>}
    <button className="btn btn-primary auth-submit" type="submit" disabled={busy}>
      {busy ? <LoaderCircle className="spin" size={17}/> : <KeyRound size={17}/>}
      {props.mode === "reset" ? t.passwordResetButton : t.passwordChangeTitle}
    </button>
  </form>;
}
