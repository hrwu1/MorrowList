/**
 * Unsent local drafts (spec 25.1): text the user typed that could not be sent is kept on
 * this device under the workspace it was meant for, and removed on sign-out with the
 * rest of the private state.
 */

const PREFIX = "morrowlist.draft.";

export function draftKey(workspaceId: string, destination: string): string {
  return `${PREFIX}${workspaceId}.${destination}`;
}

export function readDraft<T>(key: string): T | null {
  try {
    const stored = window.localStorage.getItem(key);
    return stored ? (JSON.parse(stored) as T) : null;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode); the field itself still holds the text.
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Nothing to remove, or storage is unavailable.
  }
}

export function clearAllDrafts(): void {
  try {
    const keys = Object.keys(window.localStorage).filter((key) =>
      key.startsWith(PREFIX),
    );
    for (const key of keys) window.localStorage.removeItem(key);
  } catch {
    // Storage is unavailable; there is nothing stored to leak.
  }
}
