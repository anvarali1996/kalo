// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthModal } from "@/components/auth-modal";
import { translations } from "@/lib/i18n";
import { signupFormSchema } from "@/lib/validations";
import type { Locale } from "@/lib/types";

afterEach(cleanup);
const credentials = { name: "Test User", email: "user@example.test", password: "Password123" };

describe("Signup confirmation schema", () => {
  it("rejects mismatches on the confirmation field", () => {
    const result = signupFormSchema.safeParse({ ...credentials, confirmPassword: "Different123" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(["confirmPassword"]);
  });
  it("returns only backend credentials after successful validation", () => {
    expect(signupFormSchema.parse({ ...credentials, confirmPassword: credentials.password })).toEqual(credentials);
  });
});

function fill(locale: Locale, confirmation: string) {
  const t = translations[locale];
  fireEvent.change(screen.getByLabelText(t.name), { target: { value: credentials.name } });
  fireEvent.change(screen.getByLabelText(t.email), { target: { value: credentials.email } });
  fireEvent.change(screen.getByLabelText(t.password), { target: { value: credentials.password } });
  fireEvent.change(screen.getByLabelText(t.confirmPassword), { target: { value: confirmation } });
  fireEvent.click(screen.getByRole("button", { name: t.submitSignup }));
}

describe("Existing authentication form", () => {
  it.each(["uz", "en", "ru", "lv"] as Locale[])("shows a translated mismatch and does not submit in %s", locale => {
    const submit = vi.fn();
    render(<AuthModal mode="signup" setMode={vi.fn()} locale={locale} dbConfigured submit={submit}/>);
    fill(locale, "Different123");
    expect(screen.getByRole("alert").textContent).toBe(translations[locale].passwordMismatch);
    expect(submit).not.toHaveBeenCalled();
    expect(screen.getByLabelText(translations[locale].confirmPassword).getAttribute("aria-invalid")).toBe("true");
  });
  it("submits a matching password without sending its confirmation", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    render(<AuthModal mode="signup" setMode={vi.fn()} locale="en" dbConfigured submit={submit}/>);
    fill("en", credentials.password);
    await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith("signup", credentials));
    expect(submit.mock.calls[0][1]).not.toHaveProperty("confirmPassword");
  });
  it("shows and hides both password fields", () => {
    const t = translations.en;
    render(<AuthModal mode="signup" setMode={vi.fn()} locale="en" dbConfigured submit={vi.fn()}/>);
    expect(screen.getByLabelText(t.password).getAttribute("type")).toBe("password");
    fireEvent.click(screen.getByRole("button", { name: t.showPassword }));
    expect(screen.getByLabelText(t.password).getAttribute("type")).toBe("text");
    expect(screen.getByLabelText(t.confirmPassword).getAttribute("type")).toBe("text");
    fireEvent.click(screen.getByRole("button", { name: t.hidePassword }));
    expect(screen.getByLabelText(t.confirmPassword).getAttribute("type")).toBe("password");
  });
  it("keeps login working without a confirmation field", async () => {
    const submit = vi.fn().mockResolvedValue(undefined), t = translations.en;
    render(<AuthModal mode="login" setMode={vi.fn()} locale="en" dbConfigured submit={submit}/>);
    expect(screen.queryByLabelText(t.confirmPassword)).toBeNull();
    fireEvent.change(screen.getByLabelText(t.email), { target: { value: credentials.email } });
    fireEvent.change(screen.getByLabelText(t.password), { target: { value: credentials.password } });
    fireEvent.click(screen.getByRole("button", { name: t.submitLogin }));
    await waitFor(() => expect(submit).toHaveBeenCalledExactlyOnceWith("login", { name: "", email: credentials.email, password: credentials.password }));
  });
});
