import type { MatchRangeDto } from "@morrowlist/contracts";

/**
 * Safe highlighting (spec 9.8): the server sends character offsets, this turns them into
 * plain-text segments, and the component renders each segment as text inside a `<mark>`
 * or not. No string from the server is ever interpreted as markup.
 */

export interface Segment {
  readonly text: string;
  readonly match: boolean;
}

export function segments(text: string, ranges: readonly MatchRangeDto[]): Segment[] {
  const result: Segment[] = [];
  let cursor = 0;
  for (const range of ranges) {
    const start = Math.max(range.start, cursor);
    const end = Math.min(range.end, text.length);
    if (end <= start) continue;
    if (start > cursor) result.push({ text: text.slice(cursor, start), match: false });
    result.push({ text: text.slice(start, end), match: true });
    cursor = end;
  }
  if (cursor < text.length) result.push({ text: text.slice(cursor), match: false });
  return result;
}

export const EXCERPT_RADIUS = 60;

/**
 * A window of the description around its first match, with the ranges shifted to the
 * window. A description with no match shows its opening instead.
 */
export function excerpt(
  text: string,
  ranges: readonly MatchRangeDto[],
  radius: number = EXCERPT_RADIUS,
): { readonly text: string; readonly ranges: MatchRangeDto[] } {
  const flat = text.replace(/\s+/g, " ").trim();
  const first = ranges[0];
  const anchor = first ? Math.max(0, first.start - radius) : 0;
  // Collapsing whitespace can shift offsets; only highlight when the text was already
  // flat enough for the offsets to survive.
  const stable = flat.length === text.length;
  const start = stable ? anchor : 0;
  const end = Math.min(
    flat.length,
    start + radius * 2 + (first ? first.end - first.start : 0),
  );
  const window = `${start > 0 ? "…" : ""}${flat.slice(start, end)}${end < flat.length ? "…" : ""}`;
  const shift = start > 0 ? 1 - start : 0;
  return {
    text: window,
    ranges: stable
      ? ranges
          .filter((range) => range.start >= start && range.end <= end)
          .map((range) => ({ start: range.start + shift, end: range.end + shift }))
      : [],
  };
}
