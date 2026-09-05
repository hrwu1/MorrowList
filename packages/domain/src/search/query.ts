import { ValidationError } from "../shared/errors.js";
import {
  MAX_FIELD_FILTERS,
  parseFieldFilter,
  type FieldFilter,
} from "../task/fields.js";
import { PRIORITIES, isPriority, type Priority } from "../task/values.js";

/**
 * The search query grammar (spec 9.8, GAP-02). Deliberately small and shared by the
 * search box, the CLI's `--where`, and the server: free text plus a handful of
 * `key:value` operators, no boolean algebra.
 *
 *   budget review                free text, each word prefix-matched
 *   ML-12                        a task key is resolved first
 *   due:overdue|today|future|none
 *   priority:none|low|medium|high|urgent
 *   tag:research  tag:"deep work"   tasks carrying the tag (quotes for spaces)
 *   is:open|done|blocked|deferred
 *   in:inbox
 *   deadline:overdue|week|none
 *   field:effort:gt:3          a typed custom field (GAP-24); see `parseFieldFilter`
 *
 * Keys are case-insensitive. An unknown key is ordinary text (`12:30` is a time, not an
 * operator); a known key with an unknown value is a validation error, so a typo never
 * turns into a silent empty list. A repeated operator keeps its last value.
 */

export const DUE_STATES = ["overdue", "today", "future", "none"] as const;
export type DueState = (typeof DUE_STATES)[number];
export const DEADLINE_STATES = ["overdue", "week", "none"] as const;
export type DeadlineState = (typeof DEADLINE_STATES)[number];

/**
 * Parsed operators. The field names match the task list query on purpose, so every
 * consumer maps them the same way; `tag` is a name the caller resolves to an id.
 */
export interface SearchFilters {
  readonly due?: DueState;
  readonly priority?: Priority;
  readonly tag?: string;
  readonly isCompleted?: boolean;
  readonly isBlocked?: boolean;
  readonly inbox?: boolean;
  /** `is:deferred`: hidden until a later day (GAP-16). */
  readonly deferred?: boolean;
  readonly deadline?: DeadlineState;
  /** Typed custom-field filters (GAP-24); the caller resolves them to definitions. */
  readonly fields?: readonly FieldFilter[];
}

export interface SearchQuery {
  /** The free text with operators removed and whitespace collapsed. */
  readonly text: string;
  readonly filters: SearchFilters;
}

/** The operator table, for help text and for the grammar tests. */
export const SEARCH_OPERATORS = [
  { key: "due", values: DUE_STATES, description: "due-date state" },
  { key: "priority", values: PRIORITIES, description: "priority" },
  { key: "tag", values: null, description: 'tag name; quote spaces: tag:"deep work"' },
  { key: "is", values: ["open", "done", "blocked", "deferred"], description: "state" },
  { key: "in", values: ["inbox"], description: "location" },
  { key: "deadline", values: DEADLINE_STATES, description: "deadline state" },
  {
    key: "field",
    values: null,
    description: "custom field, as key:operator[:value], e.g. field:effort:gt:3",
  },
] as const;

const IS_STATES = ["open", "done", "blocked", "deferred"] as const;

/** One token per run of non-blank characters, where a double-quoted span counts as one. */
const TOKEN = /(?:[^\s"]+|"[^"]*"?)+/g;
const OPERATOR = /^([A-Za-z]+):(.+)$/s;

function unquote(value: string): string {
  return value.replace(/^"([^"]*)"?$/s, "$1");
}

function unknownValue(key: string, value: string, allowed: readonly string[]): never {
  throw new ValidationError(
    `Unknown ${key}: value "${value}". Use ${allowed.join(", ")}.`,
    { field: "q", operator: key, value, allowed },
  );
}

export function parseSearchQuery(raw: string): SearchQuery {
  const words: string[] = [];
  let filters: SearchFilters = {};

  for (const token of raw.normalize("NFC").match(TOKEN) ?? []) {
    const match = OPERATOR.exec(token);
    const key = match?.[1]?.toLocaleLowerCase("en-US");
    const value = match ? unquote(match[2] as string) : "";

    switch (key) {
      case "due": {
        const due = value.toLocaleLowerCase("en-US");
        if (!(DUE_STATES as readonly string[]).includes(due)) {
          unknownValue(key, value, DUE_STATES);
        }
        filters = { ...filters, due: due as DueState };
        break;
      }
      case "priority": {
        const priority = value.toLocaleLowerCase("en-US");
        if (!isPriority(priority)) unknownValue(key, value, PRIORITIES);
        filters = { ...filters, priority };
        break;
      }
      case "tag": {
        const tag = value.trim().replace(/\s+/g, " ");
        if (tag.length === 0) unknownValue(key, value, ["a tag name"]);
        filters = { ...filters, tag };
        break;
      }
      case "is": {
        const state = value.toLocaleLowerCase("en-US");
        if (!(IS_STATES as readonly string[]).includes(state)) {
          unknownValue(key, value, IS_STATES);
        }
        filters =
          state === "blocked"
            ? { ...filters, isBlocked: true }
            : state === "deferred"
              ? { ...filters, deferred: true }
              : { ...filters, isCompleted: state === "done" };
        break;
      }
      case "deadline": {
        const deadline = value.toLocaleLowerCase("en-US");
        if (!(DEADLINE_STATES as readonly string[]).includes(deadline)) {
          unknownValue(key, value, DEADLINE_STATES);
        }
        filters = { ...filters, deadline: deadline as DeadlineState };
        break;
      }
      case "field": {
        const parsed = parseFieldFilter(unquote(value));
        // A repeated key keeps its last filter, like every other operator; different
        // keys accumulate up to the cap.
        const kept = (filters.fields ?? []).filter(
          (existing) => existing.key !== parsed.key,
        );
        if (kept.length + 1 > MAX_FIELD_FILTERS) {
          throw new ValidationError(
            `At most ${MAX_FIELD_FILTERS} field filters can be combined.`,
            { field: "q", operator: "field", maxFilters: MAX_FIELD_FILTERS },
          );
        }
        filters = { ...filters, fields: [...kept, parsed] };
        break;
      }
      case "in": {
        if (value.toLocaleLowerCase("en-US") !== "inbox") {
          unknownValue(key, value, ["inbox"]);
        }
        filters = { ...filters, inbox: true };
        break;
      }
      default:
        words.push(unquote(token));
    }
  }

  return { text: words.join(" ").replace(/\s+/g, " ").trim(), filters };
}

/** A query longer than this is truncated to its first terms; nobody types more. */
export const MAX_SEARCH_TERMS = 8;

/**
 * The prefix terms a text searches for: lower-cased runs of letters and digits, so the
 * terms line up with the lexemes the `simple` text-search configuration produces and
 * contain nothing a tsquery could misread.
 */
export function searchTerms(text: string): string[] {
  const terms = text
    .normalize("NFC")
    .toLocaleLowerCase("en-US")
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 0);
  return [...new Set(terms)].slice(0, MAX_SEARCH_TERMS);
}

/** A half-open `[start, end)` character range inside a string. */
export interface MatchRange {
  readonly start: number;
  readonly end: number;
}

export const MAX_MATCH_RANGES = 50;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Where the terms occur in a text, as offsets rather than markup, so a client can
 * highlight them without ever rendering HTML from the server (spec 9.8). A term matches
 * at the start of a word, the same way the prefix search does; overlapping ranges are
 * merged and the list is bounded.
 */
export function matchRanges(
  text: string | null,
  terms: readonly string[],
): MatchRange[] {
  if (!text || terms.length === 0) return [];

  const found: MatchRange[] = [];
  for (const term of terms) {
    const pattern = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(term)}`, "giu");
    for (const hit of text.matchAll(pattern)) {
      found.push({ start: hit.index, end: hit.index + hit[0].length });
      if (found.length >= MAX_MATCH_RANGES * 2) break;
    }
  }
  found.sort((left, right) => left.start - right.start || right.end - left.end);

  const merged: MatchRange[] = [];
  for (const range of found) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) {
      merged[merged.length - 1] = {
        start: last.start,
        end: Math.max(last.end, range.end),
      };
    } else {
      merged.push(range);
    }
  }
  return merged.slice(0, MAX_MATCH_RANGES);
}

/**
 * The grammar by example. The domain tests pin these, and the CLI and web tests use the
 * same rows to prove `--where` and the filter panel produce identical list queries.
 */
export const SEARCH_GRAMMAR_EXAMPLES: readonly {
  readonly query: string;
  readonly text: string;
  readonly filters: SearchFilters;
}[] = [
  { query: "budget review", text: "budget review", filters: {} },
  {
    query: "due:overdue tag:research",
    text: "",
    filters: { due: "overdue", tag: "research" },
  },
  {
    query: 'deck tag:"deep work" PRIORITY:High',
    text: "deck",
    filters: { tag: "deep work", priority: "high" },
  },
  { query: "is:blocked in:inbox", text: "", filters: { isBlocked: true, inbox: true } },
  {
    query: "is:done due:today",
    text: "",
    filters: { isCompleted: true, due: "today" },
  },
  { query: "is:open", text: "", filters: { isCompleted: false } },
  {
    query: "is:deferred deadline:week",
    text: "",
    filters: { deferred: true, deadline: "week" },
  },
  {
    query: 'meeting 12:30 foo:bar "quoted words"',
    text: "meeting 12:30 foo:bar quoted words",
    filters: {},
  },
  { query: "priority:low priority:urgent", text: "", filters: { priority: "urgent" } },
  {
    query: "field:effort:gt:3 field:stage:eq:beta",
    text: "",
    filters: {
      fields: [
        { key: "effort", op: "gt", value: "3", upper: null },
        { key: "stage", op: "eq", value: "beta", upper: null },
      ],
    },
  },
  {
    query: 'field:stage:eq:"in review" field:owner:empty',
    text: "",
    filters: {
      fields: [
        { key: "stage", op: "eq", value: "in review", upper: null },
        { key: "owner", op: "empty", value: null, upper: null },
      ],
    },
  },
];
