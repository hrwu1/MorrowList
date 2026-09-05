import type { FieldDefinitionDto, FieldType } from "@morrowlist/contracts";
import {
  FIELD_FILTER_OPERATORS as DOMAIN_OPERATORS,
  FIELD_TYPES,
  MAX_FIELD_FILTERS as DOMAIN_MAX_FILTERS,
  formatFieldFilter as domainFormat,
  matchesFieldFilter as domainMatches,
  operatorsForType as domainOperatorsForType,
  parseFieldFilter as domainParse,
} from "@morrowlist/domain";
import { describe, expect, it } from "vitest";

import {
  FIELD_FILTER_OPERATORS,
  MAX_FIELD_FILTERS,
  cardFieldValues,
  formatFieldFilter,
  formatFieldValue,
  matchesFieldFilter,
  operatorsForType,
  parseFieldFilter,
} from "./field-filters";

/**
 * The browser copy of the field-filter grammar must behave exactly like the domain's,
 * which the bundle cannot import (see the module's own comment). Every assertion here
 * compares the two implementations rather than a hand-written expectation, so a change
 * on either side fails.
 */

const EXPRESSIONS = [
  "effort:eq:3",
  "effort:ne:3",
  "effort:lt:3",
  "effort:gt:3",
  "effort:between:1..5",
  "effort:empty",
  "Story-Points:gt:2",
  'stage:eq:"in review"',
];

const BROKEN = ["effort", "effort:like:3", "effort:gt:", "effort:between:1", ":eq:1"];

describe("the browser mirror of the field-filter grammar", () => {
  it("exposes the same operators, cap and per-type operator sets", () => {
    expect(FIELD_FILTER_OPERATORS).toEqual([...DOMAIN_OPERATORS]);
    expect(MAX_FIELD_FILTERS).toBe(DOMAIN_MAX_FILTERS);
    for (const type of FIELD_TYPES as readonly FieldType[]) {
      expect(operatorsForType(type)).toEqual([...domainOperatorsForType(type)]);
    }
  });

  it("parses and formats every expression the domain does", () => {
    for (const expression of EXPRESSIONS) {
      expect(parseFieldFilter(expression)).toEqual({ ...domainParse(expression) });
      expect(formatFieldFilter(parseFieldFilter(expression)!)).toBe(
        domainFormat(domainParse(expression)),
      );
    }
  });

  it("returns null exactly where the domain throws", () => {
    for (const expression of BROKEN) {
      expect(parseFieldFilter(expression)).toBeNull();
      expect(() => domainParse(expression)).toThrow();
    }
  });

  it("matches values the same way", () => {
    const values = [{}, { effort: 1 }, { effort: 3 }, { effort: 8 }];
    for (const expression of ["effort:eq:3", "effort:gt:3", "effort:empty"]) {
      const filter = parseFieldFilter(expression)!;
      for (const value of values) {
        expect(matchesFieldFilter(value, filter)).toBe(
          domainMatches(value, domainParse(expression)),
        );
      }
    }
  });
});

describe("card rendering", () => {
  const definition = (key: string, showOnCard: boolean): FieldDefinitionDto => ({
    id: `field-${key}`,
    workspaceId: "01a04e0f-0000-7000-8000-000000000002",
    key,
    name: key,
    type: "text",
    options: [],
    rank: key,
    showOnCard,
    createdAt: "2026-09-05T09:00:00.000Z",
    updatedAt: "2026-09-05T09:00:00.000Z",
  });

  it("shows only flagged fields that have a value, at most two", () => {
    const definitions = [
      definition("a", true),
      definition("b", false),
      definition("c", true),
      definition("d", true),
    ];
    const shown = cardFieldValues(
      { a: "one", b: "hidden", c: 2, d: "three" },
      definitions,
    );

    expect(shown.map((each) => each.definition.key)).toEqual(["a", "c"]);
    expect(shown.map((each) => formatFieldValue(each.value))).toEqual(["one", "2"]);
    expect(cardFieldValues({ b: "hidden" }, definitions)).toEqual([]);
  });
});
