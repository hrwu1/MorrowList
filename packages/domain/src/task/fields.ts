import { ValidationError } from "../shared/errors.js";

/**
 * Typed custom fields (GAP-24, ADR "typed fields").
 *
 * A workspace may define at most ten fields of four types. A field is a typed slot on the
 * canonical task, not a second task model (ADR-001): the values live in one `jsonb`
 * column of `tasks`, keyed by the definition's stable `key`, and every projection reads
 * them from the task it already loaded.
 *
 * The cap and the closed type list are the design, not a limitation to be relaxed later:
 * they are what keeps a task list from becoming a spreadsheet.
 */

export const FIELD_TYPES = ["select", "number", "date", "text"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** The whole point of the plan: ten, and the eleventh is refused (GAP-24). */
export const MAX_FIELDS_PER_WORKSPACE = 10;

export const FIELD_KEY_MAX_LENGTH = 40;
export const FIELD_NAME_MAX_LENGTH = 80;
export const FIELD_TEXT_MAX_LENGTH = 200;
export const MAX_SELECT_OPTIONS = 20;
export const SELECT_OPTION_MAX_LENGTH = 60;
/** A number field holds a finite JSON number inside this range, so jsonb order is exact. */
export const FIELD_NUMBER_MAX = 1e12;

/**
 * A workspace's definition of one field. `key` is the stable identifier used in the task's
 * value map, in filter expressions, in the CLI and in export; `name` is what people read
 * and may be renamed freely.
 */
export interface FieldDefinition {
  readonly id: string;
  readonly workspaceId: string;
  readonly key: string;
  readonly name: string;
  readonly type: FieldType;
  /** The allowed values of a `select`; empty for every other type. */
  readonly options: readonly string[];
  readonly rank: string;
  /** Show the value on board cards and list rows (at most two fields are rendered). */
  readonly showOnCard: boolean;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** `number` values are JSON numbers; `select`, `date` and `text` are strings. */
export type FieldValue = string | number;

/** A task's values, keyed by field key. A key absent from the map has no value. */
export type FieldValues = Readonly<Record<string, FieldValue>>;

/** `null` clears a key; a value sets it. Absent keys are untouched (spec 20.4). */
export type FieldValuePatch = Readonly<Record<string, FieldValue | null>>;

const KEY_PATTERN = /^[a-z][a-z0-9_]*$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Normalise a field key: lower-cased, spaces and dashes folded to underscores. Keys are
 * identifiers, so they are deliberately narrow — a filter expression, a CLI flag and a
 * URL all carry them unescaped.
 */
export function normalizeFieldKey(raw: string, field = "key"): string {
  const key = raw
    .normalize("NFC")
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s-]+/g, "_");
  if (key.length === 0) {
    throw new ValidationError("Field key is required.", { field });
  }
  if (key.length > FIELD_KEY_MAX_LENGTH) {
    throw new ValidationError(
      `Field key must be ${FIELD_KEY_MAX_LENGTH} characters or fewer.`,
      { field, key, maxLength: FIELD_KEY_MAX_LENGTH },
    );
  }
  if (!KEY_PATTERN.test(key)) {
    throw new ValidationError(
      "Field key must start with a letter and use only letters, digits and underscores.",
      { field, key },
    );
  }
  return key;
}

export function normalizeFieldName(raw: string, field = "name"): string {
  const name = raw.normalize("NFC").trim().replace(/\s+/g, " ");
  if (name.length === 0) {
    throw new ValidationError("Field name is required.", { field });
  }
  if ([...name].length > FIELD_NAME_MAX_LENGTH) {
    throw new ValidationError(
      `Field name must be ${FIELD_NAME_MAX_LENGTH} characters or fewer.`,
      { field, maxLength: FIELD_NAME_MAX_LENGTH },
    );
  }
  return name;
}

export function isFieldType(value: string): value is FieldType {
  return (FIELD_TYPES as readonly string[]).includes(value);
}

/**
 * The options of a `select`, de-duplicated and order-preserving. Every other type has
 * none, so a definition can never carry options its type would ignore.
 */
export function normalizeFieldOptions(
  type: FieldType,
  raw: readonly string[] | undefined,
): readonly string[] {
  if (type !== "select") {
    if (raw && raw.length > 0) {
      throw new ValidationError("Only a select field has options.", {
        field: "options",
        type,
      });
    }
    return [];
  }

  const options: string[] = [];
  for (const candidate of raw ?? []) {
    const option = candidate.normalize("NFC").trim().replace(/\s+/g, " ");
    if (option.length === 0) continue;
    if ([...option].length > SELECT_OPTION_MAX_LENGTH) {
      throw new ValidationError(
        `A select option must be ${SELECT_OPTION_MAX_LENGTH} characters or fewer.`,
        { field: "options", option, maxLength: SELECT_OPTION_MAX_LENGTH },
      );
    }
    if (!options.includes(option)) options.push(option);
  }
  if (options.length === 0) {
    throw new ValidationError("A select field needs at least one option.", {
      field: "options",
    });
  }
  if (options.length > MAX_SELECT_OPTIONS) {
    throw new ValidationError(
      `A select field may have at most ${MAX_SELECT_OPTIONS} options.`,
      { field: "options", maxOptions: MAX_SELECT_OPTIONS },
    );
  }
  return options;
}

/**
 * Coerce and check one value against its definition. Returns the canonical stored form,
 * so what a filter compares and what export writes are always the same shape.
 */
export function validateFieldValue(
  definition: FieldDefinition,
  value: FieldValue,
): FieldValue {
  const field = `fields.${definition.key}`;
  switch (definition.type) {
    case "number": {
      const numeric = typeof value === "number" ? value : Number(String(value).trim());
      if (!Number.isFinite(numeric)) {
        throw new ValidationError(`${definition.name} must be a number.`, {
          field,
          value,
        });
      }
      if (Math.abs(numeric) > FIELD_NUMBER_MAX) {
        throw new ValidationError(
          `${definition.name} must be between -${FIELD_NUMBER_MAX} and ${FIELD_NUMBER_MAX}.`,
          { field, value: numeric },
        );
      }
      return numeric;
    }
    case "date": {
      const date = String(value).trim();
      if (!DATE_PATTERN.test(date) || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) {
        throw new ValidationError(`${definition.name} must be a date (YYYY-MM-DD).`, {
          field,
          value,
        });
      }
      return date;
    }
    case "select": {
      const option = String(value).trim().replace(/\s+/g, " ");
      if (!definition.options.includes(option)) {
        throw new ValidationError(
          `${definition.name} must be one of: ${definition.options.join(", ")}.`,
          { field, value, allowed: definition.options },
        );
      }
      return option;
    }
    default: {
      const text = String(value).normalize("NFC").trim();
      if (text.length === 0) {
        throw new ValidationError(
          `${definition.name} cannot be blank; clear it instead.`,
          { field },
        );
      }
      if ([...text].length > FIELD_TEXT_MAX_LENGTH) {
        throw new ValidationError(
          `${definition.name} must be ${FIELD_TEXT_MAX_LENGTH} characters or fewer.`,
          { field, maxLength: FIELD_TEXT_MAX_LENGTH },
        );
      }
      return text;
    }
  }
}

/**
 * Apply a patch of field values to a task's current map. An omitted key is untouched, an
 * explicit `null` clears the key, and every other value is validated against its
 * definition (spec 20.4). Keys are stored in the definitions' own order, so two tasks
 * with the same values serialise identically and the activity diff is stable.
 */
export function applyFields(
  current: FieldValues,
  patch: FieldValuePatch,
  definitions: readonly FieldDefinition[],
): FieldValues {
  const byKey = new Map(definitions.map((definition) => [definition.key, definition]));
  const next: Record<string, FieldValue> = { ...current };

  for (const [rawKey, value] of Object.entries(patch)) {
    const definition = byKey.get(rawKey);
    if (!definition) {
      throw new ValidationError(`No field named "${rawKey}" in this workspace.`, {
        field: `fields.${rawKey}`,
        key: rawKey,
        known: definitions.map((each) => each.key),
      });
    }
    if (value === null) delete next[rawKey];
    else next[rawKey] = validateFieldValue(definition, value);
  }

  return canonicalFieldValues(next, definitions);
}

/**
 * Drop values whose definition is gone and order the rest by definition, so a stored map
 * is always canonical. Deleting a definition clears its key from every task, but a task
 * read before that ran still projects cleanly.
 */
export function canonicalFieldValues(
  values: FieldValues,
  definitions: readonly FieldDefinition[],
): FieldValues {
  const result: Record<string, FieldValue> = {};
  for (const definition of definitions) {
    const value = values[definition.key];
    if (value !== undefined) result[definition.key] = value;
  }
  return result;
}

/** Structural equality of two value maps, for the material-change check (spec 18.2). */
export function sameFieldValues(left: FieldValues, right: FieldValues): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => Object.is(left[key], right[key]));
}

/**
 * The task CSV carries one column per definition, named `field:<key>` (GAP-24). The
 * prefix keeps them out of `COLUMN_ALIASES`' namespace, so a spreadsheet with a column
 * literally called "status" still means the workflow column and not a custom field.
 */
export const FIELD_COLUMN_PREFIX = "field:";

export function fieldColumnName(key: string): string {
  return `${FIELD_COLUMN_PREFIX}${key}`;
}

/**
 * The field key a CSV header names, or null when the header is not a field column. The
 * key is normalised, so `Field: Story Points` and `field:story_points` are the same
 * column; a header the key rules refuse is not a field column rather than an error,
 * because the importer reports it as ignored instead of rejecting the whole file.
 */
export function parseFieldColumn(header: string): string | null {
  const raw = header.trim();
  if (!raw.toLocaleLowerCase("en-US").startsWith(FIELD_COLUMN_PREFIX)) return null;
  try {
    return normalizeFieldKey(raw.slice(FIELD_COLUMN_PREFIX.length));
  } catch {
    return null;
  }
}

/** Human-readable value for a card, a row, or the CLI. */
export function formatFieldValue(value: FieldValue | undefined): string {
  if (value === undefined) return "";
  return typeof value === "number" ? String(value) : value;
}

/* ------------------------------------------------------------------ filters */

/**
 * The operators the scope names, spelled for a URL. `empty` takes no value; `between`
 * takes two. Which ones a field offers depends on its type.
 */
export const FIELD_FILTER_OPERATORS = [
  "eq",
  "ne",
  "lt",
  "gt",
  "between",
  "empty",
] as const;
export type FieldFilterOperator = (typeof FIELD_FILTER_OPERATORS)[number];

const ORDERED_OPERATORS: readonly FieldFilterOperator[] = [
  "eq",
  "ne",
  "lt",
  "gt",
  "between",
  "empty",
];
const UNORDERED_OPERATORS: readonly FieldFilterOperator[] = ["eq", "ne", "empty"];

/** `<` and `>` only mean something where the values have an order (number, date). */
export function operatorsForType(type: FieldType): readonly FieldFilterOperator[] {
  return type === "number" || type === "date" ? ORDERED_OPERATORS : UNORDERED_OPERATORS;
}

/**
 * One field filter. `value` is the comparison value in its stored form; `upper` is the
 * second bound of `between`. Both are null for `empty`.
 */
export interface FieldFilter {
  readonly key: string;
  readonly op: FieldFilterOperator;
  readonly value: FieldValue | null;
  readonly upper: FieldValue | null;
}

/** At most this many field filters in one query; more is a spreadsheet, not a list. */
export const MAX_FIELD_FILTERS = 4;

const BETWEEN_SEPARATOR = "..";

/**
 * Parse `<key>:<op>[:<value>]` — the one spelling of a field filter, shared by the list
 * query (`field.<key>=<op>:<value>`), the search grammar (`field:<key>:<op>:<value>`),
 * the saved-view round trip and the list URL. `between` takes `low..high`.
 *
 * Values stay strings here because the definitions are not in scope; the application
 * layer coerces them with `resolveFieldFilter` once it has loaded them.
 */
export function parseFieldFilter(expression: string): FieldFilter {
  const raw = expression.trim();
  const first = raw.indexOf(":");
  if (first <= 0) {
    throw new ValidationError(
      `Field filter "${expression}" must read key:operator[:value].`,
      { field: "field", value: expression },
    );
  }
  const key = normalizeFieldKey(raw.slice(0, first), "field");
  const rest = raw.slice(first + 1);
  const second = rest.indexOf(":");
  const opText = (second === -1 ? rest : rest.slice(0, second))
    .trim()
    .toLocaleLowerCase("en-US");
  const valueText = second === -1 ? "" : rest.slice(second + 1);

  if (!(FIELD_FILTER_OPERATORS as readonly string[]).includes(opText)) {
    throw new ValidationError(
      `Unknown field operator "${opText}". Use ${FIELD_FILTER_OPERATORS.join(", ")}.`,
      { field: "field", operator: opText, allowed: FIELD_FILTER_OPERATORS },
    );
  }
  const op = opText as FieldFilterOperator;

  if (op === "empty") return { key, op, value: null, upper: null };

  if (op === "between") {
    const [low, high] = splitOnce(valueText, BETWEEN_SEPARATOR);
    if (!low || !high) {
      throw new ValidationError(
        `"between" needs two values: ${key}:between:low${BETWEEN_SEPARATOR}high.`,
        { field: "field", value: valueText },
      );
    }
    return { key, op, value: unquoteValue(low), upper: unquoteValue(high) };
  }

  const value = unquoteValue(valueText.trim());
  if (value.length === 0) {
    throw new ValidationError(`"${opText}" needs a value: ${key}:${opText}:value.`, {
      field: "field",
      operator: opText,
    });
  }
  return { key, op, value, upper: null };
}

/** A value may be quoted so it can contain spaces: `stage:eq:"in review"`. */
function unquoteValue(value: string): string {
  return value.replace(/^"([^"]*)"?$/s, "$1").trim();
}

function splitOnce(text: string, separator: string): [string, string] | [] {
  const index = text.indexOf(separator);
  if (index === -1) return [];
  return [text.slice(0, index).trim(), text.slice(index + separator.length).trim()];
}

/** The inverse of `parseFieldFilter`; what a URL, a saved view or the CLI writes back. */
export function formatFieldFilter(filter: FieldFilter): string {
  if (filter.op === "empty") return `${filter.key}:empty`;
  if (filter.op === "between") {
    return `${filter.key}:between:${filter.value ?? ""}${BETWEEN_SEPARATOR}${filter.upper ?? ""}`;
  }
  return `${filter.key}:${filter.op}:${filter.value ?? ""}`;
}

/**
 * Bind a parsed filter to its definition: the operator must suit the type and the values
 * are coerced to their stored form, so the repository compares like with like.
 */
export function resolveFieldFilter(
  filter: FieldFilter,
  definition: FieldDefinition,
): FieldFilter {
  const allowed = operatorsForType(definition.type);
  if (!allowed.includes(filter.op)) {
    throw new ValidationError(
      `"${filter.op}" cannot be used on ${definition.name}; use ${allowed.join(", ")}.`,
      { field: "field", operator: filter.op, type: definition.type, allowed },
    );
  }
  if (filter.op === "empty") return { ...filter, value: null, upper: null };
  return {
    ...filter,
    value: filter.value === null ? null : validateFieldValue(definition, filter.value),
    upper: filter.upper === null ? null : validateFieldValue(definition, filter.upper),
  };
}

/**
 * Does a task's values satisfy a resolved filter? The SQL repository implements the same
 * six comparisons on `jsonb`; this is the in-memory double and the client-side check.
 * Numbers compare numerically and every other type lexicographically, which is
 * chronological for ISO dates.
 */
export function matchesFieldFilter(values: FieldValues, filter: FieldFilter): boolean {
  const value = values[filter.key];
  if (filter.op === "empty") return value === undefined;
  if (value === undefined) return filter.op === "ne";

  switch (filter.op) {
    case "eq":
      return compareValues(value, filter.value) === 0;
    case "ne":
      return compareValues(value, filter.value) !== 0;
    case "lt":
      return compareValues(value, filter.value) < 0;
    case "gt":
      return compareValues(value, filter.value) > 0;
    default:
      return (
        compareValues(value, filter.value) >= 0 &&
        compareValues(value, filter.upper) <= 0
      );
  }
}

function compareValues(left: FieldValue, right: FieldValue | null): number {
  if (right === null) return 1;
  if (typeof left === "number" && typeof right === "number") {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  const a = String(left);
  const b = String(right);
  return a === b ? 0 : a < b ? -1 : 1;
}
