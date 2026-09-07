import { describe, expect, it } from "vitest";

import { encodeCsvField, formatCsv, parseCsv } from "./csv.js";

describe("encodeCsvField", () => {
  it("quotes only what would otherwise break a record", () => {
    expect(encodeCsvField("plain")).toBe("plain");
    expect(encodeCsvField("with, comma")).toBe('"with, comma"');
    expect(encodeCsvField('say "hi"')).toBe('"say ""hi"""');
    expect(encodeCsvField("two\nlines")).toBe('"two\nlines"');
  });
});

describe("parseCsv", () => {
  it("reads quoted commas, doubled quotes, and embedded newlines", () => {
    const rows = parseCsv('a,b,c\r\n"x, y","say ""hi""","two\nlines"\r\n');

    expect(rows).toEqual([
      ["a", "b", "c"],
      ["x, y", 'say "hi"', "two\nlines"],
    ]);
  });

  it("drops a trailing newline and blank padding lines but keeps empty cells", () => {
    expect(parseCsv("a,b\n1,\n\n2,3\n")).toEqual([
      ["a", "b"],
      ["1", ""],
      ["2", "3"],
    ]);
  });

  it("ignores the byte-order mark a spreadsheet writes", () => {
    expect(parseCsv("﻿title,status\nWrite,Ready")).toEqual([
      ["title", "status"],
      ["Write", "Ready"],
    ]);
  });

  it("round-trips every value the archive can contain", () => {
    const rows = [
      ["key", "title", "description"],
      ["ML-000001", 'A "quoted", comma title', "line one\r\nline two"],
      ["ML-000002", "", "  "],
    ];

    expect(parseCsv(formatCsv(rows))).toEqual([
      ["key", "title", "description"],
      ["ML-000001", 'A "quoted", comma title', "line one\r\nline two"],
      ["ML-000002", "", "  "],
    ]);
  });
});
