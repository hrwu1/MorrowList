import { describe, expect, it } from "vitest";

import {
  MAX_SEARCH_TERMS,
  SEARCH_GRAMMAR_EXAMPLES,
  matchRanges,
  parseSearchQuery,
  searchTerms,
} from "./query.js";

describe("parseSearchQuery", () => {
  it.each(SEARCH_GRAMMAR_EXAMPLES)("parses $query", ({ query, text, filters }) => {
    expect(parseSearchQuery(query)).toEqual({ text, filters });
  });

  it("treats an empty or blank query as no text and no filters", () => {
    expect(parseSearchQuery("")).toEqual({ text: "", filters: {} });
    expect(parseSearchQuery("   ")).toEqual({ text: "", filters: {} });
  });

  it("keeps a half-typed operator as text rather than failing", () => {
    expect(parseSearchQuery("due:")).toEqual({ text: "due:", filters: {} });
  });

  it("rejects an unknown value for a known operator with the allowed list", () => {
    expect(() => parseSearchQuery("due:tomorrow")).toThrow(
      /Unknown due: value "tomorrow". Use overdue, today, future, none./,
    );
    expect(() => parseSearchQuery("priority:asap")).toThrow(/Unknown priority/);
    expect(() => parseSearchQuery("is:stuck")).toThrow(/open, done, blocked/);
    expect(() => parseSearchQuery("in:project")).toThrow(/Use inbox/);
    expect(() => parseSearchQuery("deadline:soon")).toThrow(/overdue, week, none/);
    expect(() => parseSearchQuery('tag:""')).toThrow(/Unknown tag/);
  });

  it("reads an unterminated quoted tag to the end of the query", () => {
    expect(parseSearchQuery('tag:"deep work').filters).toEqual({ tag: "deep work" });
  });
});

describe("searchTerms", () => {
  it("lower-cases runs of letters and digits and drops punctuation", () => {
    expect(searchTerms("Deep-Work: ML-12 (v2)")).toEqual([
      "deep",
      "work",
      "ml",
      "12",
      "v2",
    ]);
  });

  it("de-duplicates and bounds the term list", () => {
    expect(searchTerms("a a b")).toEqual(["a", "b"]);
    const many = Array.from({ length: 20 }, (_, index) => `t${index}`).join(" ");
    expect(searchTerms(many)).toHaveLength(MAX_SEARCH_TERMS);
  });

  it("keeps non-Latin letters", () => {
    expect(searchTerms("Café Übung 東京")).toEqual(["café", "übung", "東京"]);
  });
});

describe("matchRanges", () => {
  it("finds each term at word starts, case-insensitively, as offsets", () => {
    expect(matchRanges("Budget review: the budgeting budget", ["budget"])).toEqual([
      { start: 0, end: 6 },
      { start: 19, end: 25 },
      { start: 29, end: 35 },
    ]);
  });

  it("does not match inside a word", () => {
    expect(matchRanges("rebudget", ["budget"])).toEqual([]);
  });

  it("merges overlapping ranges from different terms", () => {
    expect(matchRanges("presentation", ["present", "presentation"])).toEqual([
      { start: 0, end: 12 },
    ]);
  });

  it("returns nothing for a missing text or no terms", () => {
    expect(matchRanges(null, ["a"])).toEqual([]);
    expect(matchRanges("a", [])).toEqual([]);
  });

  it("never treats a term as a pattern", () => {
    expect(matchRanges("a.b c", ["a.b"])).toEqual([{ start: 0, end: 3 }]);
    expect(matchRanges("axb", ["a.b"])).toEqual([]);
  });
});
