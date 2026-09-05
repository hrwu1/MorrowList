import type {
  FieldDefinitionDto,
  FieldFilterDto,
  FieldFilterOperator,
  FieldType,
  FieldValueDto,
  FieldValuesDto,
} from "@morrowlist/contracts";

/**
 * The field-filter grammar, mirrored for the browser bundle (GAP-24).
 *
 * `@morrowlist/domain` is the source of truth, but its entry point reaches `node:crypto`
 * through `uuidv7`, which webpack cannot bundle. These four helpers are the pure part the
 * client needs; `field-filters.test.ts` pins them against the domain's own
 * implementations so the copy cannot drift.
 */

export const FIELD_FILTER_OPERATORS: readonly FieldFilterOperator[] = [
  "eq",
  "ne",
  "lt",
  "gt",
  "between",
  "empty",
];

export const MAX_FIELD_FILTERS = 4;

const BETWEEN_SEPARATOR = "..";

/** `<` and `>` only mean something where the values have an order (number, date). */
export function operatorsForType(type: FieldType): readonly FieldFilterOperator[] {
  return type === "number" || type === "date"
    ? FIELD_FILTER_OPERATORS
    : (["eq", "ne", "empty"] as const);
}

/** Parse `<key>:<op>[:<value>]`; returns null when the expression is not one. */
export function parseFieldFilter(expression: string): FieldFilterDto | null {
  const raw = expression.trim();
  const first = raw.indexOf(":");
  if (first <= 0) return null;
  const key = raw
    .slice(0, first)
    .trim()
    .toLocaleLowerCase("en-US")
    .replace(/[\s-]+/g, "_");
  if (!/^[a-z][a-z0-9_]*$/.test(key)) return null;

  const rest = raw.slice(first + 1);
  const second = rest.indexOf(":");
  const op = (second === -1 ? rest : rest.slice(0, second))
    .trim()
    .toLocaleLowerCase("en-US") as FieldFilterOperator;
  if (!FIELD_FILTER_OPERATORS.includes(op)) return null;
  const valueText = second === -1 ? "" : rest.slice(second + 1);

  if (op === "empty") return { key, op, value: null, upper: null };
  if (op === "between") {
    const index = valueText.indexOf(BETWEEN_SEPARATOR);
    if (index === -1) return null;
    const value = unquote(valueText.slice(0, index));
    const upper = unquote(valueText.slice(index + BETWEEN_SEPARATOR.length));
    if (!value || !upper) return null;
    return { key, op, value, upper };
  }

  const value = unquote(valueText);
  return value.length === 0 ? null : { key, op, value, upper: null };
}

export function formatFieldFilter(filter: FieldFilterDto): string {
  if (filter.op === "empty") return `${filter.key}:empty`;
  if (filter.op === "between") {
    return `${filter.key}:between:${filter.value ?? ""}${BETWEEN_SEPARATOR}${filter.upper ?? ""}`;
  }
  return `${filter.key}:${filter.op}:${filter.value ?? ""}`;
}

/**
 * The same six comparisons the SQL repository runs, for the optimistic cache check.
 * Numbers compare numerically, everything else lexicographically — chronological for
 * ISO dates.
 */
export function matchesFieldFilter(
  values: FieldValuesDto,
  filter: FieldFilterDto,
): boolean {
  const value = values[filter.key];
  if (filter.op === "empty") return value === undefined;
  if (value === undefined) return filter.op === "ne";

  switch (filter.op) {
    case "eq":
      return compare(value, filter.value) === 0;
    case "ne":
      return compare(value, filter.value) !== 0;
    case "lt":
      return compare(value, filter.value) < 0;
    case "gt":
      return compare(value, filter.value) > 0;
    default:
      return compare(value, filter.value) >= 0 && compare(value, filter.upper) <= 0;
  }
}

/** How a value reads on a card, a row, or the detail. */
export function formatFieldValue(value: FieldValueDto | undefined): string {
  if (value === undefined) return "";
  return typeof value === "number" ? String(value) : value;
}

/** The values a task shows on a card: the flagged fields it actually has, at most two. */
export const MAX_CARD_FIELDS = 2;

export function cardFieldValues(
  values: FieldValuesDto,
  definitions: readonly FieldDefinitionDto[],
): { readonly definition: FieldDefinitionDto; readonly value: FieldValueDto }[] {
  return definitions
    .filter(
      (definition) => definition.showOnCard && values[definition.key] !== undefined,
    )
    .slice(0, MAX_CARD_FIELDS)
    .map((definition) => ({
      definition,
      value: values[definition.key] as FieldValueDto,
    }));
}

function unquote(value: string): string {
  return value
    .trim()
    .replace(/^"([^"]*)"?$/s, "$1")
    .trim();
}

function compare(left: FieldValueDto, right: FieldValueDto | null): number {
  if (right === null) return 1;
  if (typeof left === "number" && typeof right === "number") {
    return left === right ? 0 : left < right ? -1 : 1;
  }
  const a = String(left);
  const b = String(right);
  return a === b ? 0 : a < b ? -1 : 1;
}
