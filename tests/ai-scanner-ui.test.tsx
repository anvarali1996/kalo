// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiFoodScanner } from "@/components/ai-food-scanner";
import { BillingPlans } from "@/components/billing-plans";
import { translations } from "@/lib/i18n";
import type { CreditsResponse } from "@/lib/ai-types";

vi.mock("@/lib/prepare-food-photo", () => ({ prepareFoodPhoto: vi.fn().mockResolvedValue("data:image/jpeg;base64,/9j/2Q==") }));
const t = translations.en;
const user = { id: "123e4567-e89b-42d3-a456-426614174000", name: "Test", email: "test@example.test" };
const estimate = { containsFood: true, foods: [
  { name: "Rice", portionGrams: 200, kcal: 260, protein: 5.4, carbs: 56, fat: 0.6 },
  { name: "Chicken", portionGrams: 100, kcal: 165, protein: 31, carbs: 0, fat: 3.6 },
], notes: "Estimated portions." };
const account: CreditsResponse = {
  credits: 6, plan: "basic", monthlyCredits: 6, purchasedCredits: 0, monthlyExpiresAt: "2026-12-01T00:00:00Z",
  renewalAt: null, cancelAt: null, subscriptionStatus: null, canSubscribe: true, proCheckoutId: null,
  purchases: [], hasMore: false, scanningAvailable: true, availableProducts: ["pro", "pack20", "pack50"], portalAvailable: false,
};
const packButton = t.billingBuyPack.replace("{count}", "20");
const scanId = "123e4567-e89b-42d3-a456-426614174001";
const result = { id: scanId, result: estimate, credits: 5, saved: false };
const fetchMock = vi.fn();
const notify = vi.fn(), onEntriesAdded = vi.fn(), openAuth = vi.fn();
const reply = (data: unknown) => Promise.resolve(new Response(JSON.stringify(data), { headers: { "Content-Type": "application/json" } }));

beforeEach(() => {
  sessionStorage.clear(); vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
  fetchMock.mockImplementation((url: string) => {
    if (url.startsWith("/api/ai/credits")) return reply(account);
    if (url.endsWith("/diary")) return reply({ entries: [{ id: "diary-entry", date: "2026-11-18", source: "ai" }] });
    if (url === "/api/ai/scans") return reply(result);
    return reply({ ...result, status: "succeeded" });
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const mount = (signedIn = true) => render(<AiFoodScanner locale="en" user={signedIn ? user : null} today="2026-11-18" openAuth={openAuth} onEntriesAdded={onEntriesAdded} notify={notify}/>);

it.each(["uz", "en", "ru", "lv"] as const)("shows the new Pro price and scan allowance in %s", locale => {
  render(<BillingPlans locale={locale} account={account} signedIn buying={null} busy={false} onBuy={vi.fn()}/>);
  const pro = screen.getByRole("heading", { name: "Pro" }).closest("article");
  expect(pro?.textContent).toMatch(/7[.,]99/);
  expect(pro?.textContent).toContain("€");
  expect(pro?.textContent).toContain(translations[locale].billingProDetail.replace("{count}", "120"));
});

async function uploadAndScan() {
  await waitFor(() => expect(screen.getByRole("button", { name: packButton }).hasAttribute("disabled")).toBe(false));
  fireEvent.change(screen.getByLabelText(t.aiUpload), { target: { files: [new File(["photo"], "meal.jpg", { type: "image/jpeg" })] } });
  await waitFor(() => expect(screen.getByRole("button", { name: t.aiAnalyze }).hasAttribute("disabled")).toBe(false));
  fireEvent.click(screen.getByRole("button", { name: t.aiAnalyze }));
  await screen.findByRole("heading", { name: t.aiResults });
}

describe("AI meal photo UI", () => {
  it("gates photo analysis behind the existing sign-in flow", () => {
    mount(false);
    expect(screen.getByText(t.aiLoginRequired)).toBeTruthy();
    expect(screen.queryByLabelText(t.aiUpload)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: t.login }));
    expect(openAuth).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("shows estimated macros, recalculates edited portions, and saves to the diary", async () => {
    mount(); await uploadAndScan();
    expect(screen.getByText(t.aiEstimate)).toBeTruthy();
    const inputs = screen.getAllByLabelText(`${t.portion} (${t.grams})`);
    fireEvent.change(inputs[0], { target: { value: "100" } });
    expect(screen.getByRole("heading", { name: "Rice" }).closest("article")!.textContent).toContain("130 kcal");
    fireEvent.click(screen.getByRole("button", { name: t.aiSave }));
    await waitFor(() => expect(onEntriesAdded).toHaveBeenCalledOnce());
    const saveCall = fetchMock.mock.calls.find(([url]) => url.endsWith("/diary"));
    expect(JSON.parse(saveCall![1].body)).toEqual({ date: "2026-11-18", portions: [100, 100] });
    expect(notify).toHaveBeenCalledWith(t.aiSaved);
    expect(screen.getByRole("button", { name: t.aiSaved }).hasAttribute("disabled")).toBe(true);
  });
  it("blocks invalid portions before sending a save request", async () => {
    mount(); await uploadAndScan();
    fireEvent.change(screen.getAllByLabelText(`${t.portion} (${t.grams})`)[0], { target: { value: "0" } });
    expect(screen.getByRole("button", { name: t.aiSave }).hasAttribute("disabled")).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith("/diary"))).toBe(false);
  });
  it("recovers a charged scan after a lost POST response without rescanning", async () => {
    const original = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((url: string, options: RequestInit) => url === "/api/ai/scans" ? Promise.reject(new TypeError("Connection lost")) : original(url, options));
    mount(); await uploadAndScan();
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url.startsWith("/api/ai/scans/"))).toBe(true));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/ai/scans")).toHaveLength(1);
  });
  it("shows a pending payment after a browser success return without inventing credits", async () => {
    window.history.replaceState({}, "", `/?checkout=success&purchase=${scanId}`);
    mount();
    expect(await screen.findByText(t.aiPaymentPending)).toBeTruthy();
    await waitFor(() => expect(screen.getByRole("button", { name: packButton }).hasAttribute("disabled")).toBe(false));
    expect(screen.queryByText(t.aiPaymentConfirmed)).toBeNull();
    expect(fetchMock.mock.calls.every(([, options]) => options.method === "GET")).toBe(true);
  });
});
