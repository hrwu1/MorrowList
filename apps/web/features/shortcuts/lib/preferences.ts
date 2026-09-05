/**
 * The one shortcut setting (GAP-10): single-key shortcuts on or off.
 *
 * It is a per-device preference about how this browser reads the keyboard, not workspace
 * data, so it lives in `localStorage` rather than on the server. Storage can throw — a
 * private window, or a browser configured to block site data — so every access is
 * defensive and the default (on) is what the app falls back to.
 */

export const SINGLE_KEY_STORAGE_KEY = "morrowlist.shortcuts.single-key";

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function readSingleKeyEnabled(storage: PreferenceStorage | null): boolean {
  if (!storage) return true;
  try {
    return storage.getItem(SINGLE_KEY_STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export function writeSingleKeyEnabled(
  storage: PreferenceStorage | null,
  enabled: boolean,
): void {
  if (!storage) return;
  try {
    storage.setItem(SINGLE_KEY_STORAGE_KEY, enabled ? "on" : "off");
  } catch {
    // A browser that refuses to store the preference still honours it for this session.
  }
}

/** `localStorage` when the browser has one and allows it, otherwise null. */
export function browserStorage(): PreferenceStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}
