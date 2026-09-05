import { describe, expect, it } from "vitest";

import { ValidationError } from "../shared/errors.js";

import {
  FIELD_FILTER_OPERATORS,
  applyFields,
  canonicalFieldValues,
  formatFieldFilter,
  matchesFieldFilter,
  normalizeFieldKey,
  normalizeFieldName,
  normalizeFieldOptions,
  operatorsForType,
  parseFieldFilter,
  resolveFieldFilter,
  sameFieldValues,
  validateFieldValue,
  type FieldDefinition,
  type FieldType,
} from "./fields.js";

const NOW = new Date("2026-08-29T09:00:00.000Z");

function definition(overrides: Partial<FieldDefinition> = {}): FieldDefinition {
  const type: FieldType = overrides.type ?? "text";
  return {
    id: `field-${overrides.key ?? "notes"}`,
    workspaceId: "workspace-1",
    key: overrides.key ?? "notes",
    name: overrides.name ?? "Notes",
    type,
    options: overrides.options ?? (type === "select" ? ["alpha", "beta"] : []),
    rank: overrides.rank ?? "a0",
    showOnCard: overrides.showOnCard ?? false,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
}

describe("normalizeFieldKey", () => {
  it("folds spaces and dashes into a lower-case identifier", () => {
    expect(normalizeFieldKey("  Story Points ")).toBe("story_points");
    expect(normalizeFieldKey("T-Shirt-Size")).toBe("t_shirt_size");
  });

  it("refuses a key that is empty, too long, or not an identifier", () => {
    expect(() => normalizeFieldKey("  ")).toThrow(ValidationError);
    expect(() => normalizeFieldKey("9lives")).toThrow(ValidationError);
    expect(() => normalizeFieldKey("a".repeat(41))).toThrow(ValidationError);
  });
});

describe("normalizeFieldName", () => {
  it("collapses whitespace and keeps the casing", () => {
    expect(normalizeFieldName("  Story   Points ")).toBe("Story Points");
  });

  it("refuses an empty name", () => {
    expect(() => normalizeFieldName(" ")).toThrow(ValidationError);
  });
});

describe("normalizeFieldOptions", () => {
  it("de-duplicates and trims a select's options", () => {
    expect(normalizeFieldOptions("select", [" Alpha ", "Alpha", "beta", " "])).toEqual([
      "Alpha",
      "beta",
    ]);
  });

  it("refuses options on a type that has none, and a select with none", () => {
    expect(() => normalizeFieldOptions("number", ["one"])).toThrow(ValidationError);
    expect(() => normalizeFieldOptions("select", [])).toThrow(ValidationError);
  });

  it("caps the number of options", () => {
    const many = Array.from({ length: 21 }, (_, index) => `option-${index}`);
    expect(() => normalizeFieldOptions("select", many)).toThrow(ValidationError);
  });
});

describe("validateFieldValue", () => {
  it("coerces a numeric string and refuses a non-number", () => {
    const effort = definition({ key: "effort", name: "Effort", type: "number" });
    expect(validateFieldValue(effort, " 3 ")).toBe(3);
    expect(validateFieldValue(effort, 2.5)).toBe(2.5);
    expect(() => validateFieldValue(effort, "soon")).toThrow(ValidationError);
  });

  it("requires a calendar date", () => {
    const target = definition({ key: "target", name: "Target", type: "date" });
    expect(validateFieldValue(target, "2026-09-15")).toBe("2026-09-15");
    expect(() => validateFieldValue(target, "15/09/2026")).toThrow(ValidationError);
  });

  it("requires a select value to be one of the options", () => {
    const stage = definition({ key: "stage", name: "Stage", type: "select" });
    expect(validateFieldValue(stage, " beta ")).toBe("beta");
    expect(() => validateFieldValue(stage, "gamma")).toThrow(ValidationError);
  });

  it("refuses blank text and text that is too long", () => {
    const notes = definition();
    expect(validateFieldValue(notes, "  hello  ")).toBe("hello");
    expect(() => validateFieldValue(notes, "   ")).toThrow(ValidationError);
    expect(() => validateFieldValue(notes, "x".repeat(201))).toThrow(ValidationError);
  });
});

describe("applyFields", () => {
  const definitions = [
    definition({ key: "effort", name: "Effort", type: "number" }),
    definition({ key: "stage", name: "Stage", type: "select" }),
  ];

  it("sets, clears and leaves keys alone, in definition order", () => {
    const next = applyFields({ stage: "alpha" }, { effort: "3" }, definitions);
    expect(next).toEqual({ effort: 3, stage: "alpha" });
    expect(Object.keys(next)).toEqual(["effort", "stage"]);

    expect(applyFields(next, { stage: null }, definitions)).toEqual({ effort: 3 });
    expect(applyFields(next, {}, definitions)).toEqual(next);
  });

  it("refuses a key the workspace has not defined", () => {
    expect(() => applyFields({}, { nope: "1" }, definitions)).toThrow(ValidationError);
  });

  it("drops values whose definition is gone", () => {
    expect(canonicalFieldValues({ effort: 3, ghost: "x" }, definitions)).toEqual({
      effort: 3,
    });
  });
});

describe("sameFieldValues", () => {
  it("compares structurally", () => {
    expect(sameFieldValues({ a: 1, b: "x" }, { b: "x", a: 1 })).toBe(true);
    expect(sameFieldValues({ a: 1 }, { a: 2 })).toBe(false);
    expect(sameFieldValues({ a: 1 }, { a: 1, b: "x" })).toBe(false);
  });
});

describe("parseFieldFilter", () => {
  it("reads every operator and round-trips through the format", () => {
    const cases = [
      "effort:eq:3",
      "effort:ne:3",
      "effort:lt:3",
      "effort:gt:3",
      "effort:between:1..5",
      "effort:empty",
    ];
    for (const expression of cases) {
      expect(formatFieldFilter(parseFieldFilter(expression))).toBe(expression);
    }
    expect(FIELD_FILTER_OPERATORS).toHaveLength(cases.length);
  });

  it("unquotes a value that contains spaces", () => {
    expect(parseFieldFilter('stage:eq:"in review"')).toEqual({
      key: "stage",
      op: "eq",
      value: "in review",
      upper: null,
    });
  });

  it("refuses a malformed expression, an unknown operator, or a missing value", () => {
    expect(() => parseFieldFilter("effort")).toThrow(ValidationError);
    expect(() => parseFieldFilter("effort:like:3")).toThrow(ValidationError);
    expect(() => parseFieldFilter("effort:gt:")).toThrow(ValidationError);
    expect(() => parseFieldFilter("effort:between:1")).toThrow(ValidationError);
  });
});

describe("operatorsForType and resolveFieldFilter", () => {
  it("offers ordering operators only where the values have an order", () => {
    expect(operatorsForType("number")).toContain("between");
    expect(operatorsForType("date")).toContain("lt");
    expect(operatorsForType("text")).not.toContain("lt");
    expect(operatorsForType("select")).toEqual(["eq", "ne", "empty"]);
  });

  it("coerces the values to their stored form", () => {
    const effort = definition({ key: "effort", name: "Effort", type: "number" });
    expect(resolveFieldFilter(parseFieldFilter("effort:between:1..5"), effort)).toEqual(
      {
        key: "effort",
        op: "between",
        value: 1,
        upper: 5,
      },
    );
  });

  it("refuses an operator the type does not support", () => {
    const stage = definition({ key: "stage", name: "Stage", type: "select" });
    expect(() => resolveFieldFilter(parseFieldFilter("stage:gt:beta"), stage)).toThrow(
      ValidationError,
    );
  });
});

describe("matchesFieldFilter", () => {
  const effort = definition({ key: "effort", name: "Effort", type: "number" });
  const resolve = (expression: string) =>
    resolveFieldFilter(parseFieldFilter(expression), effort);

  it("compares numbers numerically", () => {
    expect(matchesFieldFilter({ effort: 10 }, resolve("effort:gt:9"))).toBe(true);
    expect(matchesFieldFilter({ effort: 10 }, resolve("effort:lt:9"))).toBe(false);
    expect(matchesFieldFilter({ effort: 3 }, resolve("effort:between:1..5"))).toBe(
      true,
    );
    expect(matchesFieldFilter({ effort: 7 }, resolve("effort:between:1..5"))).toBe(
      false,
    );
  });

  it("treats a missing value as empty, and as 'is not' anything", () => {
    expect(matchesFieldFilter({}, resolve("effort:empty"))).toBe(true);
    expect(matchesFieldFilter({ effort: 1 }, resolve("effort:empty"))).toBe(false);
    expect(matchesFieldFilter({}, resolve("effort:ne:1"))).toBe(true);
    expect(matchesFieldFilter({}, resolve("effort:eq:1"))).toBe(false);
  });

  it("compares dates chronologically because ISO order is lexicographic", () => {
    const target = definition({ key: "target", name: "Target", type: "date" });
    const filter = resolveFieldFilter(parseFieldFilter("target:gt:2026-09-01"), target);
    expect(matchesFieldFilter({ target: "2026-10-01" }, filter)).toBe(true);
    expect(matchesFieldFilter({ target: "2026-08-01" }, filter)).toBe(false);
  });
});
