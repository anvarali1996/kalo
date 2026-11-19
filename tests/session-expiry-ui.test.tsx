// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KaloApp } from "@/components/kalo-app";
import { translations } from "@/lib/i18n";
import { requestSessionCheck } from "@/lib/session-client";
import { localDate } from "@/lib/calories";

vi.mock("@/components/pwa", () => ({ PwaInstallBanner: () => null, PwaRegistration: () => null }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("returns a revoked device to sign-in and removes account data from the open page", async () => {
  let signedIn = true;
  const account = { id: "signed-in-user", name: "Signed-in account", email: "account@example.test" };
  const privateEntry = {
    id: "account-meal", date: localDate(), name: "Private meal", grams: 100, kcal: 240,
    protein: null, carbs: null, fat: null, barcode: null, image: null, source: "manual",
  };
  const localEntry = { ...privateEntry, id: "device-meal", name: "Device demo meal" };
  localStorage.setItem("kalo_demo", JSON.stringify({ diary: [localEntry] }));
  localStorage.setItem("kalo_locale", "en");
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    if (url === "/api/auth/me") {
      return Response.json({ user: signedIn ? account : null, databaseConfigured: true });
    }
    expect(url).toBe("/api/state");
    return Response.json({ diary: [privateEntry], profile: null, weights: [] });
  }));

  render(<KaloApp/>);
  await screen.findByText(account.name);
  const navigation = screen.getByRole("navigation", { name: "Main navigation" });
  fireEvent.click(within(navigation).getByRole("button", { name: translations.en.navDiary }));
  expect(screen.getByText(privateEntry.name)).toBeTruthy();

  signedIn = false;
  act(requestSessionCheck);
  await screen.findByRole("dialog", { name: translations.en.loginTitle });
  expect(screen.getByText(translations.en.sessionEnded)).toBeTruthy();
  expect(screen.queryByText(privateEntry.name)).toBeNull();
  expect(screen.getByText(localEntry.name)).toBeTruthy();
  await waitFor(() => expect(localStorage.getItem("kalo_demo")).not.toContain(privateEntry.name));
});
