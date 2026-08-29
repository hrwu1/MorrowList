/**
 * A small Markdown subset for task descriptions (spec 8.1, 10.2).
 *
 * Parsing produces a tree, and the renderer turns that tree into React elements. Nothing
 * anywhere produces an HTML string, so raw HTML in a description cannot be rendered — it
 * is escaped as text by React, which is what "raw HTML disabled" has to mean to be worth
 * anything. That is also why there is no Markdown library here: the whole security
 * property of this feature is that no HTML path exists.
 *
 * The supported subset is what a task note actually uses: headings, lists, fenced code,
 * block quotes, paragraphs, and inline emphasis, code, and links.
 */

export type InlineNode =
  | { readonly kind: "text"; readonly value: string }
  | { readonly kind: "code"; readonly value: string }
  | { readonly kind: "strong"; readonly children: readonly InlineNode[] }
  | { readonly kind: "emphasis"; readonly children: readonly InlineNode[] }
  | {
      readonly kind: "link";
      readonly href: string;
      readonly children: readonly InlineNode[];
    };

export type Block =
  | {
      readonly kind: "heading";
      readonly level: 1 | 2 | 3;
      readonly content: readonly InlineNode[];
    }
  | { readonly kind: "paragraph"; readonly content: readonly InlineNode[] }
  | { readonly kind: "quote"; readonly content: readonly InlineNode[] }
  | {
      readonly kind: "list";
      readonly ordered: boolean;
      readonly items: readonly (readonly InlineNode[])[];
    }
  | {
      readonly kind: "codeBlock";
      readonly language: string | null;
      readonly value: string;
    };

/** Schemes a description may link to. Anything else renders as plain text. */
const SAFE_SCHEMES = ["http:", "https:", "mailto:"];

export function isSafeHref(href: string): boolean {
  try {
    // A relative href has no scheme of its own and cannot smuggle `javascript:`.
    return SAFE_SCHEMES.includes(new URL(href, "https://morrowlist.invalid").protocol);
  } catch {
    return false;
  }
}

const HEADING = /^(#{1,3})\s+(.*)$/;
const UNORDERED = /^[-*+]\s+(.*)$/;
const ORDERED = /^\d{1,9}[.)]\s+(.*)$/;
const QUOTE = /^>\s?(.*)$/;
const FENCE = /^```\s*([A-Za-z0-9+#-]*)\s*$/;

export function parseMarkdown(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.trim().length === 0) {
      index += 1;
      continue;
    }

    const fence = FENCE.exec(line);
    if (fence) {
      const body: string[] = [];
      index += 1;
      while (index < lines.length && !FENCE.test(lines[index] ?? "")) {
        body.push(lines[index] ?? "");
        index += 1;
      }
      // A missing closing fence still yields a code block rather than losing the text.
      index += 1;
      blocks.push({
        kind: "codeBlock",
        language: fence[1] ? fence[1] : null,
        value: body.join("\n"),
      });
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: (heading[1]?.length ?? 1) as 1 | 2 | 3,
        content: parseInline(heading[2] ?? ""),
      });
      index += 1;
      continue;
    }

    if (QUOTE.test(line)) {
      const parts: string[] = [];
      while (index < lines.length && QUOTE.test(lines[index] ?? "")) {
        parts.push(QUOTE.exec(lines[index] ?? "")?.[1] ?? "");
        index += 1;
      }
      blocks.push({ kind: "quote", content: parseInline(parts.join(" ")) });
      continue;
    }

    const ordered = ORDERED.test(line);
    if (ordered || UNORDERED.test(line)) {
      const pattern = ordered ? ORDERED : UNORDERED;
      const items: InlineNode[][] = [];
      while (index < lines.length && pattern.test(lines[index] ?? "")) {
        items.push(parseInline(pattern.exec(lines[index] ?? "")?.[1] ?? ""));
        index += 1;
      }
      blocks.push({ kind: "list", ordered, items });
      continue;
    }

    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index] ?? "";
      const startsAnotherBlock =
        current.trim().length === 0 ||
        HEADING.test(current) ||
        QUOTE.test(current) ||
        FENCE.test(current) ||
        UNORDERED.test(current) ||
        ORDERED.test(current);
      if (startsAnotherBlock) break;
      paragraph.push(current.trim());
      index += 1;
    }
    blocks.push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
  }

  return blocks;
}

/**
 * Inline scanner. Delimiters that never close are emitted as literal text, so a stray
 * asterisk in a note reads as an asterisk instead of swallowing the rest of the line.
 */
export function parseInline(source: string): InlineNode[] {
  const nodes: InlineNode[] = [];
  let text = "";
  let index = 0;

  const flush = () => {
    if (text.length > 0) {
      nodes.push({ kind: "text", value: text });
      text = "";
    }
  };

  while (index < source.length) {
    const rest = source.slice(index);

    if (rest.startsWith("`")) {
      const end = rest.indexOf("`", 1);
      if (end > 0) {
        flush();
        nodes.push({ kind: "code", value: rest.slice(1, end) });
        index += end + 1;
        continue;
      }
    }

    if (rest.startsWith("[")) {
      const link = /^\[([^\]]*)\]\(([^)\s]*)\)/.exec(rest);
      if (link) {
        const href = link[2] ?? "";
        flush();
        const children = parseInline(link[1] ?? "");
        // An unsafe scheme loses its link, not its text.
        nodes.push(
          isSafeHref(href)
            ? { kind: "link", href, children }
            : { kind: "text", value: link[1] ?? "" },
        );
        index += link[0].length;
        continue;
      }
    }

    if (rest.startsWith("**")) {
      const end = rest.indexOf("**", 2);
      if (end > 2) {
        flush();
        nodes.push({ kind: "strong", children: parseInline(rest.slice(2, end)) });
        index += end + 2;
        continue;
      }
    }

    const marker = rest[0];
    if (marker === "*" || marker === "_") {
      const end = rest.indexOf(marker, 1);
      if (end > 1) {
        flush();
        nodes.push({ kind: "emphasis", children: parseInline(rest.slice(1, end)) });
        index += end + 1;
        continue;
      }
    }

    text += source[index];
    index += 1;
  }

  flush();
  return nodes;
}
