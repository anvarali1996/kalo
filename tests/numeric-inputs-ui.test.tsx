// @vitest-environment jsdom
import React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { KaloApp } from "@/components/kalo-app";
import { ScannerView } from "@/components/scanner";
import { translations } from "@/lib/i18n";
import { defaultProfile, type Product } from "@/lib/types";

vi.mock("@/components/pwa", () => ({ PwaInstallBanner: () => null, PwaRegistration: () => null }));

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it.each(["en", "uz", "ru", "lv"] as const)("lets users clear and replace saved measurements in %s", async locale => {
  const t = translations[locale];
  const profile = { ...defaultProfile, age: 30, heightCm: 170, weightKg: 80, goalWeightKg: 70 };
  localStorage.setItem("kalo_locale", locale);
  localStorage.setItem("kalo_demo", JSON.stringify({ profile }));
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ user: null, databaseConfigured: false })));

  render(<KaloApp/>);
  await screen.findByRole("heading", { name: t.overview });
  const hero = screen.getByRole("region", { name: t.greeting });
  fireEvent.click(within(hero).getByRole("button", { name: t.planAction }));

  const labels = [t.age, t.height, t.currentWeight, t.targetWeight];
  const fields = labels.map(name => screen.getByRole<HTMLInputElement>("spinbutton", { name }));
  expect(fields.map(field => field.value)).toEqual(["30", "170", "80", "70"]);
  for (const field of fields) {
    fireEvent.change(field, { target: { value: "" } });
    expect(field.value).toBe("");
    expect(field.validity.valueMissing).toBe(true);
  }

  fireEvent.submit(fields[0].form!);
  expect((await screen.findByRole("alert")).textContent).toBe(t.formError);
  expect(JSON.parse(localStorage.getItem("kalo_demo")!).profile).toEqual(profile);

  const replacements = ["36", "181", "78.5", "72.3"];
  fields.forEach((field, index) => fireEvent.change(field, { target: { value: replacements[index] } }));
  fireEvent.click(screen.getByRole("button", { name: t.saveProfile }));
  await waitFor(() => expect(JSON.parse(localStorage.getItem("kalo_demo")!).profile).toEqual({
    ...profile, age: 36, heightCm: 181, weightKg: 78.5, goalWeightKg: 72.3,
  }));
});

it("allows a scanned food portion to be erased and saves its replacement", async () => {
  const t = translations.en;
  const product: Product = {
    barcode: "3017620422003", name: "Example food", brand: "", image: null,
    kcal100: 200, protein100: 12, carbs100: 23, fat100: 5, sugar100: null, salt100: null,
    fiber100: null, nutriscore: null, nova: null, ingredients: null, allergens: [], serving: null, quantity: null,
  };
  const addEntry = vi.fn(async () => {});
  const fetchMock = vi.fn(async () => Response.json({ product }));
  vi.stubGlobal("fetch", fetchMock);
  render(<ScannerView locale="en" addEntry={addEntry} notify={vi.fn()} today="2026-11-19"/>);
  fireEvent.change(screen.getByRole("textbox", { name: t.enterBarcode }), { target: { value: product.barcode } });
  fireEvent.click(screen.getByRole("button", { name: t.findProduct }));

  const productHeading = await screen.findByRole("heading", { name: product.name });
  const card = within(productHeading.closest<HTMLElement>("#product-results")!);
  const portion = card.getByRole<HTMLInputElement>("spinbutton", { name: `${t.portion} (${t.grams})` });
  expect(portion.value).toBe("100");
  const save = card.getByRole<HTMLButtonElement>("button", { name: t.addToDiary });
  fireEvent.change(portion, { target: { value: "" } });
  expect(portion.value).toBe("");
  expect(save.disabled).toBe(true);

  fireEvent.change(portion, { target: { value: "75" } });
  fireEvent.click(save);
  await waitFor(() => expect(addEntry).toHaveBeenCalledWith(expect.objectContaining({ grams: 75, kcal: 150 })));
});
