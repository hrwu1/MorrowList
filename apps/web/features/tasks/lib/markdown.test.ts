import { describe, expect, it } from "vitest";

import { isSafeHref, parseInline, parseMarkdown } from "./markdown";

describe("parseMarkdown", () => {
  it("reads headings, lists, quotes, and fenced code", () => {
    const blocks = parseMarkdown(
      [
        "## Plan",
        "",
        "- buy milk",
        "- call the bank",
        "",
        "> quoted",
        "",
        "```sql",
        "select 1",
        "```",
      ].join("\n"),
    );

    expect(blocks.map((block) => block.kind)).toEqual([
      "heading",
      "list",
      "quote",
      "codeBlock",
    ]);
    expect(blocks[0]).toMatchObject({ level: 2 });
    expect(blocks[1]).toMatchObject({
      ordered: false,
      items: [
        [{ kind: "text", value: "buy milk" }],
        [{ kind: "text", value: "call the bank" }],
      ],
    });
    expect(blocks[3]).toMatchObject({ language: "sql", value: "select 1" });
  });

  it("joins wrapped lines into one paragraph and splits on a blank line", () => {
    const blocks = parseMarkdown("first line\nstill first\n\nsecond");

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      kind: "paragraph",
      content: [{ kind: "text", value: "first line still first" }],
    });
  });

  it("keeps ordered and unordered lists apart", () => {
    const blocks = parseMarkdown("1. one\n2. two");

    expect(blocks[0]).toMatchObject({ kind: "list", ordered: true });
    expect(blocks[0]).toMatchObject({
      items: [[{ kind: "text", value: "one" }], [{ kind: "text", value: "two" }]],
    });
  });

  it("treats HTML as text, because descriptions never render raw HTML", () => {
    // The parser has no HTML branch at all; a tag can only come out as a text node,
    // which React escapes (spec 8.1).
    const blocks = parseMarkdown("<script>alert(1)</script>");

    expect(blocks).toEqual([
      {
        kind: "paragraph",
        content: [{ kind: "text", value: "<script>alert(1)</script>" }],
      },
    ]);
  });

  it("returns nothing for an empty description", () => {
    expect(parseMarkdown("   \n\n  ")).toEqual([]);
  });
});

describe("parseInline", () => {
  it("reads bold, italic, code, and links", () => {
    expect(parseInline("**bold** *soft* `code` [site](https://example.com)")).toEqual([
      { kind: "strong", children: [{ kind: "text", value: "bold" }] },
      { kind: "text", value: " " },
      { kind: "emphasis", children: [{ kind: "text", value: "soft" }] },
      { kind: "text", value: " " },
      { kind: "code", value: "code" },
      { kind: "text", value: " " },
      {
        kind: "link",
        href: "https://example.com",
        children: [{ kind: "text", value: "site" }],
      },
    ]);
  });

  it("leaves an unclosed delimiter as literal text", () => {
    expect(parseInline("2 * 3 is not emphasis")).toEqual([
      { kind: "text", value: "2 * 3 is not emphasis" },
    ]);
  });

  it("strips the link from an unsafe scheme but keeps the label", () => {
    expect(parseInline("[click](javascript:alert)")).toEqual([
      { kind: "text", value: "click" },
    ]);
    expect(parseInline("[report](data:text/html;base64,PHA+)")).toEqual([
      { kind: "text", value: "report" },
    ]);
  });
});

describe("isSafeHref", () => {
  it("allows only web and mail schemes", () => {
    expect(isSafeHref("https://example.com")).toBe(true);
    expect(isSafeHref("http://example.com")).toBe(true);
    expect(isSafeHref("mailto:a@example.com")).toBe(true);
    expect(isSafeHref("/relative/path")).toBe(true);
    expect(isSafeHref("javascript:alert(1)")).toBe(false);
    expect(isSafeHref("data:text/html,<script>")).toBe(false);
  });
});
