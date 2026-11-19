// @vitest-environment jsdom
import React, { useState } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AuthModal, type AuthMode } from "@/components/auth-modal";
import { ResetPasswordView } from "@/components/reset-password-view";
import { PasswordForm } from "@/components/password-form";
import { translations } from "@/lib/i18n";

const fetchMock = vi.fn();
function mockApi() {
  fetchMock.mockReset().mockImplementation(async () => Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetchMock);
}

afterEach(() => {
  cleanup();
  window.history.replaceState({}, "", "/");
  localStorage.clear();
  document.documentElement.lang = "uz";
  vi.unstubAllGlobals();
});

it("offers forgot password from login and shows the generic acknowledgment", async () => {
  const t = translations.lv;
  mockApi();
  function Login() {
    const [mode, setMode] = useState<AuthMode | null>("login");
    return mode ? <AuthModal mode={mode} setMode={setMode} dbConfigured locale="lv" submit={vi.fn()}/> : null;
  }
  render(<Login/>);
  fireEvent.click(screen.getByRole("button", { name: t.forgotPassword }));
  expect(screen.getByRole("dialog", { name: t.passwordResetTitle })).toBeTruthy();
  fireEvent.change(screen.getByLabelText(t.email), { target: { value: "person@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: t.passwordSendLink }));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", t.passwordResetSent);
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ email: "person@example.test", locale: "lv" });
});

it.each(["uz", "en", "ru", "lv"] as const)("resets a password from an email link with translated confirmation in %s", async locale => {
  const t = translations[locale];
  const token = "a".repeat(43);
  window.history.replaceState({}, "", `/reset-password#token=${token}&lang=${locale}`);
  mockApi();
  render(<ResetPasswordView/>);
  const password = await screen.findByLabelText(t.passwordNew);
  expect(window.location.hash).toBe("");
  const confirm = screen.getByLabelText(t.confirmPassword);
  fireEvent.change(password, { target: { value: "replacement-password" } });
  fireEvent.change(confirm, { target: { value: "incorrect-confirmation" } });
  fireEvent.click(screen.getByRole("button", { name: t.passwordResetButton }));
  expect(screen.getByRole("alert")).toHaveProperty("textContent", t.passwordMismatch);
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.change(confirm, { target: { value: "replacement-password" } });
  fireEvent.click(screen.getByRole("button", { name: t.passwordResetButton }));
  expect(await screen.findByRole("status")).toHaveProperty("textContent", t.passwordResetSuccess);
  expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/reset-password");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ password: "replacement-password", token });
});

it("requires the current password and omits confirmation from the profile password API", async () => {
  const t = translations.en;
  const onSuccess = vi.fn();
  mockApi();
  render(<PasswordForm locale="en" mode="change" onSuccess={onSuccess}/>);
  fireEvent.change(screen.getByLabelText(t.passwordCurrent), { target: { value: "current-password" } });
  fireEvent.change(screen.getByLabelText(t.passwordNew), { target: { value: "replacement-password" } });
  fireEvent.change(screen.getByLabelText(t.confirmPassword), { target: { value: "replacement-password" } });
  fireEvent.click(screen.getByRole("button", { name: t.passwordChangeTitle }));
  await waitFor(() => expect(onSuccess).toHaveBeenCalledOnce());
  expect(fetchMock.mock.calls[0][0]).toBe("/api/auth/change-password");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    currentPassword: "current-password", password: "replacement-password",
  });
});
