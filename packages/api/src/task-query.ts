import { MAX_FIELD_FILTERS, parseFieldFilter } from "@morrowlist/domain";
import type { z } from "zod";

import { ApiError } from "./errors.js";
import { parseQuery } from "./middleware/validate.js";

/** List and export must interpret the same task filters before schema validation. */
export function parseTaskQuery<T extends z.ZodType>(
  query: Record<string, string | undefined>,
  schema: T,
): z.infer<T> {
  return parseQuery(withFieldFilters(query), schema);
}

/**
 * Fold the typed custom-field parameters of a list query into the array the contract
 * carries (GAP-24). On the wire each filter is its own parameter — `field.effort=gt:3`,
 * `field.stage=eq:beta`, `field.owner=empty` — because that reads in an address bar and
 * needs no escaping beyond the value itself. A malformed expression is a validation
 * error, never a silently wider list.
 */
function withFieldFilters(
  query: Record<string, string | undefined>,
): Record<string, unknown> {
  const filters = Object.entries(query).flatMap(([name, value]) =>
    name.startsWith("field.") ? [`${name.slice("field.".length)}:${value ?? ""}`] : [],
  );
  if (filters.length === 0) return query;
  if (filters.length > MAX_FIELD_FILTERS) {
    throw new ApiError(
      "VALIDATION_FAILED",
      `At most ${MAX_FIELD_FILTERS} field filters can be combined.`,
      { field: "fields", maxFilters: MAX_FIELD_FILTERS },
    );
  }
  return {
    ...query,
    fields: filters.map((expression) => parseFieldFilter(expression)),
  };
}
