import type { MatchRangeDto } from "@morrowlist/contracts";

/**
 * Fuzzy matching for the command palette (GAP-10).
 *
 * A command matches when the typed characters appear in order in its title or keywords.
 * The score prefers matches that start a word and matches whose characters sit close
 * together, so "cot" reaches "Complete task" before "Copy of the…". Ranges come back in
 * the same `{ start, end }` shape the server uses for search hits, so the palette can
 * reuse the search feature's `Highlighted` renderer.
 */

export interface FuzzyMatch {
  readonly score: number;
  readonly ranges: readonly MatchRangeDto[];
}

const START_BONUS = 12;
const CONSECUTIVE_BONUS = 6;
const GAP_PENALTY = 1;

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1] as string;
  return previous === " " || previous === "-" || previous === "/";
}

/** The match of `query` inside `text`, or null. An empty query matches with score 0. */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return { score: 0, ranges: [] };
  const haystack = text.toLowerCase();

  const ranges: MatchRangeDto[] = [];
  let score = 0;
  let cursor = 0;
  let previousIndex = -2;

  for (const character of needle) {
    if (character === " ") continue;
    const index = haystack.indexOf(character, cursor);
    if (index === -1) return null;
    if (isBoundary(haystack, index)) score += START_BONUS;
    if (index === previousIndex + 1) score += CONSECUTIVE_BONUS;
    else score -= Math.min(index - cursor, 10) * GAP_PENALTY;

    const last = ranges[ranges.length - 1];
    if (last && last.end === index)
      ranges[ranges.length - 1] = { ...last, end: index + 1 };
    else ranges.push({ start: index, end: index + 1 });

    previousIndex = index;
    cursor = index + 1;
  }

  // A short title that used most of its characters is a better answer than a long one.
  score += Math.max(0, 20 - (text.length - needle.length) / 4);
  return { score, ranges };
}

export interface Rankable {
  readonly title: string;
  readonly keywords?: string | undefined;
}

export interface RankedCommand<T extends Rankable> {
  readonly command: T;
  readonly ranges: readonly MatchRangeDto[];
  readonly score: number;
}

/**
 * Commands that match, best first. Keywords widen what matches but never highlight, so
 * a command found by a synonym still shows its plain title.
 */
export function rankCommands<T extends Rankable>(
  commands: readonly T[],
  query: string,
): readonly RankedCommand<T>[] {
  const ranked: RankedCommand<T>[] = [];
  for (const command of commands) {
    const onTitle = fuzzyMatch(query, command.title);
    if (onTitle) {
      ranked.push({ command, ranges: onTitle.ranges, score: onTitle.score });
      continue;
    }
    const onKeywords = command.keywords ? fuzzyMatch(query, command.keywords) : null;
    if (onKeywords) {
      // Found by a synonym rather than by what is on screen; rank it below the rest.
      ranked.push({ command, ranges: [], score: onKeywords.score - 40 });
    }
  }
  // Stable within a score so the registry's own order is the tie-breaker.
  return ranked
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.score - a.entry.score || a.index - b.index)
    .map(({ entry }) => entry);
}
