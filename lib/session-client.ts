import type { SessionUser } from "./types";

const checkSessionEvent = "kalo:check-session";
const checkIntervalMs = 15_000;

export function requestSessionCheck() {
  if (typeof window !== "undefined") window.dispatchEvent(new window.Event(checkSessionEvent));
}

/** Poll only while in use, and validate again when the user returns to the tab. */
export function monitorSession(onCheck: (user: SessionUser | null) => void) {
  const controller = new AbortController();
  let checking = false;
  const check = async () => {
    if (checking || document.hidden || controller.signal.aborted) return;
    checking = true;
    try {
      const response = await fetch("/api/auth/me", {
        cache: "no-store", credentials: "same-origin", signal: controller.signal,
      });
      if (!response.ok) return;
      const result: { user?: SessionUser | null } = await response.json();
      if (!controller.signal.aborted && result.user !== undefined) onCheck(result.user);
    } catch {
      // Network or server failures alone do not prove that the session is invalid.
    } finally {
      checking = false;
    }
  };
  const tick = () => { void check(); };
  const timer = window.setInterval(tick, checkIntervalMs);
  window.addEventListener("focus", tick);
  window.addEventListener(checkSessionEvent, tick);
  document.addEventListener("visibilitychange", tick);
  return () => {
    controller.abort();
    window.clearInterval(timer);
    window.removeEventListener("focus", tick);
    window.removeEventListener(checkSessionEvent, tick);
    document.removeEventListener("visibilitychange", tick);
  };
}
