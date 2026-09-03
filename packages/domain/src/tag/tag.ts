import { ValidationError } from "../shared/errors.js";

/**
 * Workspace-scoped tags (spec 12.1). A tag is a label on the canonical task, not a copy
 * of it: the task–tag relation is owned by the application layer, and a tag rename is
 * visible on every task that carries it without touching those tasks.
 */
export interface Tag {
  readonly id: string;
  readonly workspaceId: string;
  /** Display form: trimmed, whitespace collapsed, original casing kept. */
  readonly name: string;
  /** Lower-cased key that makes names unique per workspace case-insensitively. */
  readonly normalizedName: string;
  readonly colorToken: TagColorToken;
  readonly description: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export const TAG_NAME_MAX_LENGTH = 80;

/** Reference-scale limit per task (spec 29.1). */
export const MAX_TAGS_PER_TASK = 20;

/**
 * Normalise a tag name for display: NFC, trimmed, with internal runs of whitespace
 * collapsed to one space so "deep  work" and "deep work" are the same tag. The casing is
 * kept because it is what the user typed; uniqueness uses `tagLookupKey`.
 */
export function normalizeTagName(raw: string): string {
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length === 0) {
    throw new ValidationError("Tag name is required.", { field: "name" });
  }
  const codePoints = [...name].length;
  if (codePoints > TAG_NAME_MAX_LENGTH) {
    throw new ValidationError(
      `Tag name must be ${TAG_NAME_MAX_LENGTH} characters or fewer.`,
      { field: "name", length: codePoints, maxLength: TAG_NAME_MAX_LENGTH },
    );
  }
  return name;
}

/** The case-insensitive uniqueness key of a display name (spec 12.1). */
export function tagLookupKey(name: string): string {
  return normalizeTagName(name).toLocaleLowerCase("en-US");
}

/**
 * Colour tokens resolve to `--tag-<token>-bg` / `--tag-<token>-text` pairs in
 * `packages/ui/src/tokens.css`. Eight hues plus a neutral, chosen to stay distinguishable
 * under the common colour-vision deficiencies; the chip always shows the name as well,
 * so colour is never the only signal (spec 14).
 */
export const TAG_COLOR_TOKENS = [
  "neutral",
  "red",
  "orange",
  "amber",
  "green",
  "teal",
  "blue",
  "violet",
  "pink",
] as const;

export type TagColorToken = (typeof TAG_COLOR_TOKENS)[number];

export const DEFAULT_TAG_COLOR: TagColorToken = "neutral";

export function isTagColorToken(value: string): value is TagColorToken {
  return (TAG_COLOR_TOKENS as readonly string[]).includes(value);
}

export function toTagColorToken(value: string, field = "colorToken"): TagColorToken {
  if (!isTagColorToken(value)) {
    throw new ValidationError("Tag colour must be one of the palette tokens.", {
      field,
      value,
      allowed: TAG_COLOR_TOKENS,
    });
  }
  return value;
}
