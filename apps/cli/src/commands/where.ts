import type { ApiClient } from "@morrowlist/api-client";
import type { ListTasksQuery, TaskDto } from "@morrowlist/contracts";
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
  op.values
    ? `${op.key}:${op.values.join("|")}`
    : op.key === "field"
      ? "field:<key>:<operator>[:<value>]"
      : `${op.key}:<name>`,
).join("  ")}`;

/** The list query a parsed filter set stands for; `tag` is resolved to an id first. */
export function listQueryFromFilters(
  filters: SearchFilters,
  tagId: string | undefined,
): Partial<ListTasksQuery> {
  const { tag: _tag, fields, ...rest } = filters;
  return {
    ...rest,
    // The list query carries the field filters as its own mutable array (GAP-24).
    ...(fields && fields.length > 0
      ? { fields: fields.map((each) => ({ ...each })) }
      : {}),
    ...(tagId ? { tagId } : {}),
  };
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

/**
 * The tasks a bulk command would touch. One page, capped by the caller: a bulk edit that
 * silently paged through thousands of tasks would be the opposite of deliberate. An
 * unresolvable `tag:` selects nothing rather than everything.
 */
export async function bulkTargets(
  client: ApiClient,
  where: string,
  limit: number,
): Promise<{ tasks: readonly TaskDto[]; error: string | null }> {
  const resolved = await resolveWhere(client, where);
  if (resolved.error) return { tasks: [], error: resolved.error };
  if (resolved.noSuchTag) return { tasks: [], error: null };

  const page = await client.listTasks({
    ...resolved.query,
    limit: limit + 1,
  } as Partial<ListTasksQuery>);
  return { tasks: page.data, error: null };
}
