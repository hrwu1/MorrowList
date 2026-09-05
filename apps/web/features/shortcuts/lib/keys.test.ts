import { describe, expect, it } from "vitest";

import {
  chordLabel,
  chordSteps,
  isChordPrefix,
  isModalOpen,
  strokeChord,
} from "./keys";

function stroke(key: string, modifiers: Partial<Record<string, boolean>> = {}) {
  return {
    key,
    metaKey: modifiers.metaKey ?? false,
    ctrlKey: modifiers.ctrlKey ?? false,
    altKey: modifiers.altKey ?? false,
  };
}

describe("strokeChord", () => {
  it("lower-cases a letter so Shift+E and e reach the same command", () => {
    expect(strokeChord(stroke("E"))).toBe("e");
    expect(strokeChord(stroke("e"))).toBe("e");
  });

  it("keeps the character Shift already produced", () => {
    expect(strokeChord(stroke("?"))).toBe("?");
    expect(strokeChord(stroke("#"))).toBe("#");
  });

  it("folds Command and Control into one portable modifier", () => {
    expect(strokeChord(stroke("k", { metaKey: true }))).toBe("mod+k");
    expect(strokeChord(stroke("k", { ctrlKey: true }))).toBe("mod+k");
  });

  it("ignores a modifier pressed on its own", () => {
    expect(strokeChord(stroke("Shift"))).toBeNull();
    expect(strokeChord(stroke("Meta", { metaKey: true }))).toBeNull();
  });

  it("ignores Alt, whose character differs by keyboard layout", () => {
    expect(strokeChord(stroke("ø", { altKey: true }))).toBeNull();
  });

  it("leaves named keys as they are", () => {
    expect(strokeChord(stroke("Escape"))).toBe("Escape");
    expect(strokeChord(stroke("ArrowDown"))).toBe("ArrowDown");
  });
});

describe("chord shapes", () => {
  it("splits a sequence into its steps", () => {
    expect(chordSteps("g t")).toEqual(["g", "t"]);
    expect(chordSteps("mod+k")).toEqual(["mod+k"]);
  });

  it("recognises a leading step but not an unrelated or equal one", () => {
    expect(isChordPrefix("g", "g t")).toBe(true);
    expect(isChordPrefix("t", "g t")).toBe(false);
    expect(isChordPrefix("g t", "g t")).toBe(false);
  });
});

describe("chordLabel", () => {
  it("reads a sequence out in words", () => {
    expect(chordLabel("g t")).toBe("G then T");
  });

  it("names the platform-neutral modifier", () => {
    expect(chordLabel("mod+k")).toBe("Ctrl/⌘ K");
  });

  it("leaves punctuation alone", () => {
    expect(chordLabel("?")).toBe("?");
  });
});

describe("isModalOpen", () => {
  it("is true only while a native dialog is open", () => {
    expect(isModalOpen({ querySelector: () => null })).toBe(false);
    expect(isModalOpen({ querySelector: () => ({}) as Element })).toBe(true);
  });
});
