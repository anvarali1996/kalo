// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { monitorSession, requestSessionCheck } from "@/lib/session-client";

const signedOut = () => new Response(JSON.stringify({ user: null }), { status: 200 });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("Device session checks", () => {
  it("checks a visible session periodically and immediately on focus or a rejected API call", async () => {
    vi.useFakeTimers();
    vi.spyOn(document, "hidden", "get").mockReturnValue(false);
    vi.stubGlobal("fetch", vi.fn(async () => signedOut()));
    const check = vi.fn();
    const stop = monitorSession(check);
    try {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(check).toHaveBeenCalledWith(null);
      window.dispatchEvent(new window.Event("focus"));
      await vi.advanceTimersByTimeAsync(0);
      requestSessionCheck();
      await vi.advanceTimersByTimeAsync(0);
      expect(check).toHaveBeenCalledTimes(3);
    } finally {
      stop();
    }
    await vi.advanceTimersByTimeAsync(15_000);
    expect(check).toHaveBeenCalledTimes(3);
  });

  it("keeps the session during a temporary server failure and checks when the page becomes visible", async () => {
    vi.useFakeTimers();
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    const fetchStatus = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockImplementationOnce(async () => signedOut());
    vi.stubGlobal("fetch", fetchStatus);
    const check = vi.fn();
    const stop = monitorSession(check);
    try {
      await vi.advanceTimersByTimeAsync(15_000);
      expect(fetchStatus).not.toHaveBeenCalled();
      hidden.mockReturnValue(false);
      document.dispatchEvent(new window.Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(check).not.toHaveBeenCalled();
      requestSessionCheck();
      await vi.advanceTimersByTimeAsync(0);
      expect(check).toHaveBeenCalledExactlyOnceWith(null);
    } finally {
      stop();
    }
  });
});
