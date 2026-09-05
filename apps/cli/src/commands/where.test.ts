import { SEARCH_GRAMMAR_EXAMPLES, parseSearchQuery } from "@morrowlist/domain";
import { describe, expect, it } from "vitest";

import { listQueryFromFilters } from "./where.js";

const TAG_ID = "0198f0a0-0000-7000-8000-000000000009";

/**
 * The completion criterion: the CLI's `--where` and the web filter panel produce
 * identical API queries. Both test suites walk the same grammar examples from the
 * domain; the web side (`features/tasks/lib/task-view.test.ts`) pins the same rows.
 */
describe("--where to list query", () => {
  it.each(SEARCH_GRAMMAR_EXAMPLES.filter((row) => row.text === ""))(
    "maps $query",
    ({ query, filters }) => {
      const { tag, fields, ...rest } = filters;
      expect(
        listQueryFromFilters(parseSearchQuery(query).filters, tag ? TAG_ID : undefined),
      ).toEqual({
        ...rest,
        ...(fields ? { fields: fields.map((each) => ({ ...each })) } : {}),
        ...(tag ? { tagId: TAG_ID } : {}),
      });
    },
  );

  it("never leaks the tag name into the query", () => {
    expect(
      listQueryFromFilters({ tag: "deep work", due: "overdue" }, undefined),
    ).toEqual({
      due: "overdue",
    });
  });
});
