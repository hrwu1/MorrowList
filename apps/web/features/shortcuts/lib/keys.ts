/**
 * Key notation for the shortcut registry (GAP-10, spec 14).
 *
 * A binding is a chord written as a lower-case string: `"e"`, `"?"`, `"mod+k"`, or a
 * two-step sequence such as `"g t"`. `mod` is Command on Apple hardware and Control
 * everywhere else, which is the same key a browser user already reaches for.
 *
 * Nothing here touches the DOM beyond reading an event, so the rules are testable.
 */

/** How long a sequence prefix such as `g` waits for its second key. */
export const CHORD_TIMEOUT_MS = 1_200;

export interface KeyStroke {
  readonly key: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
}

const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift", "OS", "AltGraph"]);

/**
 * The chord one keystroke stands for, or null when the stroke cannot start one.
 *
 * Only `mod` is encoded: Shift is already baked into the character the browser reports
 * (`?` rather than `Shift+/`), and Alt produces different characters on different layouts,
 * so an Alt chord would not be portable.
 */
export function strokeChord(stroke: KeyStroke): string | null {
  if (MODIFIER_KEYS.has(stroke.key)) return null;
  if (stroke.altKey) return null;
  const key = stroke.key.length === 1 ? stroke.key.toLowerCase() : stroke.key;
  if (stroke.metaKey || stroke.ctrlKey) return `mod+${key}`;
  return key;
}

/** The steps of a chord: `"g t"` is two, `"mod+k"` is one. */
export function chordSteps(chord: string): readonly string[] {
  return chord.split(" ");
}

/** True when `prefix` is a strict, leading part of `chord` (`"g"` of `"g t"`). */
export function isChordPrefix(prefix: string, chord: string): boolean {
  const a = chordSteps(prefix);
  const b = chordSteps(chord);
  if (a.length >= b.length) return false;
  return a.every((step, index) => step === b[index]);
}

const KEY_LABELS: Record<string, string> = {
  "mod+k": "Ctrl/⌘ K",
  "mod+z": "Ctrl/⌘ Z",
  ArrowUp: "↑",
  ArrowDown: "↓",
  Enter: "Enter",
  Escape: "Esc",
};

/** The chord as a person reads it in the cheat sheet: `"g t"` becomes `"G then T"`. */
export function chordLabel(chord: string): string {
  const known = KEY_LABELS[chord];
  if (known) return known;
  const steps = chordSteps(chord);
  if (steps.length > 1) {
    return steps.map((step) => chordLabel(step)).join(" then ");
  }
  return chord.length === 1 ? chord.toUpperCase() : chord;
}

const TYPING_TAGS = new Set(["INPUT", "TEXTAREA", "SELECT"]);

/**
 * Whether the keystroke is going into something a person is typing or editing.
 *
 * A shortcut that steals a character from a title field is worse than no shortcut at all,
 * so this errs towards "typing": any form control, anything `contenteditable`, and
 * anything inside a `role="textbox"` counts.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  if (TYPING_TAGS.has(target.tagName)) return true;
  const element = target as HTMLElement;
  if (element.isContentEditable) return true;
  return element.closest('[contenteditable="true"], [role="textbox"]') !== null;
}

/**
 * Whether a modal is on screen. Every modal surface in the app is a native `<dialog>`
 * opened with `showModal()`, so one selector covers the search dialog, the Inbox tray,
 * the palette, and the cheat sheet.
 */
export function isModalOpen(doc: Pick<Document, "querySelector">): boolean {
  return doc.querySelector("dialog[open]") !== null;
}
