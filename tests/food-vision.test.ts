import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { analyzeFoodPhoto } from "@/lib/food-vision";
import { validPhotoBytes } from "@/lib/food-photo-bytes";
import type { Locale } from "@/lib/types";

const image = "data:image/jpeg;base64,/9j/2Q==";
const estimate = { containsFood: true, foods: [{ name: "Rice", portionGrams: 200, kcal: 260, protein: 5.4, carbs: 56, fat: 0.6 }], notes: "Estimated portion." };
const fetchMock = vi.fn();
function response(value: unknown = estimate, status = "completed", refusal = false) {
  return new Response(JSON.stringify({
    id: "resp_fixture", object: "response", created_at: 1, status, error: null, incomplete_details: null, model: "gpt-4.1-mini",
    output: [{ id: "msg_fixture", type: "message", role: "assistant", status: "completed", content: refusal
      ? [{ type: "refusal", refusal: "Cannot analyze this photo" }]
      : [{ type: "output_text", text: JSON.stringify(value), annotations: [] }] }],
  }), { headers: { "Content-Type": "application/json" } });
}
beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => response());
  vi.stubGlobal("fetch", fetchMock); vi.stubEnv("OPENAI_API_KEY", "local_test_fixture_only");
  vi.stubEnv("OPENAI_VISION_MODEL", "gpt-4.1-mini");
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("OpenAI Vision SDK integration", () => {
  it.each([["uz", "Uzbek"], ["en", "English"], ["ru", "Russian"], ["lv", "Latvian"]])("uses structured vision output with the %s language", async (locale, language) => {
    expect(await analyzeFoodPhoto(image, locale as Locale)).toEqual(estimate);
    const [url, options] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/responses");
    const body = JSON.parse(options.body);
    expect(body.store).toBe(false);
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.instructions).toContain(language);
    expect(body.text.format).toMatchObject({ type: "json_schema", strict: true, name: "food_nutrition_estimate" });
    expect(body.input[0].content[1]).toEqual({ type: "input_image", image_url: image, detail: "high" });
  });
  it("treats no-food, refusals, and incomplete responses as unsuccessful", async () => {
    fetchMock.mockImplementationOnce(async () => response({ containsFood: false, foods: [], notes: "No food" }));
    await expect(analyzeFoodPhoto(image, "en")).rejects.toMatchObject({ code: "aiNoFood" });
    fetchMock.mockImplementationOnce(async () => response(undefined, "completed", true));
    await expect(analyzeFoodPhoto(image, "en")).rejects.toMatchObject({ code: "aiScanFailed" });
    fetchMock.mockImplementationOnce(async () => response(estimate, "incomplete"));
    await expect(analyzeFoodPhoto(image, "en")).rejects.toMatchObject({ code: "aiScanFailed" });
  });
  it("rejects invalid nutrition values rather than returning an estimate", async () => {
    fetchMock.mockImplementationOnce(async () => response({ ...estimate, foods: [{ ...estimate.foods[0], portionGrams: 0 }] }));
    await expect(analyzeFoodPhoto(image, "en")).rejects.toMatchObject({ code: "aiScanFailed" });
  });
  it("requires a configured server API key", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    await expect(analyzeFoodPhoto(image, "en")).rejects.toMatchObject({ code: "aiUnavailable" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("checks photo magic bytes and refuses noncanonical or disguised content", () => {
    expect(validPhotoBytes(image)).toBe(true);
    expect(validPhotoBytes("data:image/png;base64,/9j/2Q==")).toBe(false);
    expect(validPhotoBytes("data:image/jpeg;base64,dGV4dA==")).toBe(false);
    expect(validPhotoBytes("data:image/jpeg;base64,/9j/2Q")).toBe(false);
  });
});
