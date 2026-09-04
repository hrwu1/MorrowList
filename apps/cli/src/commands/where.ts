import type { ApiClient } from "@morrowlist/api-client";
import type { ListTasksQuery } from "@morrowlist/contracts";
import {
  SEARCH_OPERATORS,
  parseSearchQuery,
  type SearchFilters,
} from "@morrowlist/domain";

import { findTag } from "./tag.js";

/**
 * `--where "<query>"`: the same operator grammar the search box accepts, turned into a
 * task list query (spec 21.3). Free text has no place in a list, so it is refused here;
 * `morrow search` is the command for words.
 */

export const WHERE_HELP = `operators: ${SEARCH_OPERATORS.map((op) =>
  op.values ? `${op.key}:${op.values.join("|")}` : `${op.key}:<name>`,
).join("  ")}`;

/** The list query a parsed filter set stands for; `tag` is resolved to an id first. */
export function listQueryFromFilters(
  filters: SearchFilters,
  tagId: string | undefined,
): Partial<ListTasksQuery> {
  const { tag: _tag, ...rest } = filters;
  return { ...rest, ...(tagId ? { tagId } : {}) };
}

export interface WhereResult {
  readonly query: Partial<ListTasksQuery>;
  /** True when `tag:` named a tag the workspace does not have: the list is empty. */
  readonly noSuchTag: boolean;
  readonly error: string | null;
}

export async function resolveWhere(
  client: ApiClient,
  where: string,
): Promise<WhereResult> {
  const parsed = parseSearchQuery(where);
  if (parsed.text.length > 0) {
    return {
      query: {},
      noSuchTag: false,
      error: `--where takes operators only (${WHERE_HELP}); use \`morrow search\` for words.`,
    };
  }
  const tag = parsed.filters.tag ? await findTag(client, parsed.filters.tag) : null;
  return {
    query: listQueryFromFilters(parsed.filters, tag?.id),
    noSuchTag: Boolean(parsed.filters.tag) && !tag,
    error: null,
  };
}
