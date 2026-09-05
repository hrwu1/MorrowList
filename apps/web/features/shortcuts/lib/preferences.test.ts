import { describe, expect, it } from "vitest";

import {
  SINGLE_KEY_STORAGE_KEY,
  readSingleKeyEnabled,
  writeSingleKeyEnabled,
  type PreferenceStorage,
} from "./preferences";

function memoryStorage(initial: Record<string, string> = {}): PreferenceStorage {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

const throwingStorage: PreferenceStorage = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("the single-key preference", () => {
  it("is on until it has been switched off", () => {
    expect(readSingleKeyEnabled(memoryStorage())).toBe(true);
  });

  it("survives a round trip", () => {
    const storage = memoryStorage();
    writeSingleKeyEnabled(storage, false);
    expect(storage.getItem(SINGLE_KEY_STORAGE_KEY)).toBe("off");
    expect(readSingleKeyEnabled(storage)).toBe(false);
    writeSingleKeyEnabled(storage, true);
    expect(readSingleKeyEnabled(storage)).toBe(true);
  });

  it("stays on when the browser has no storage, or refuses it", () => {
    expect(readSingleKeyEnabled(null)).toBe(true);
    expect(readSingleKeyEnabled(throwingStorage)).toBe(true);
    expect(() => writeSingleKeyEnabled(throwingStorage, false)).not.toThrow();
    expect(() => writeSingleKeyEnabled(null, false)).not.toThrow();
  });
});
