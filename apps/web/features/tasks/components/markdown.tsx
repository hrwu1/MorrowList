"use client";

import { Fragment, type ReactNode } from "react";

import { parseMarkdown, type Block, type InlineNode } from "../lib/markdown";

/**
 * Renders a parsed description as React elements (spec 10.2).
 *
 * There is deliberately no `dangerouslySetInnerHTML` anywhere on this path. Everything
 * that is not a recognised Markdown construct arrives here as a text node and is escaped
 * by React, so a description containing HTML shows the HTML rather than running it.
 */
export function Markdown({ source }: { readonly source: string }) {
  const blocks = parseMarkdown(source);
  if (blocks.length === 0) return null;

  return (
    <div className="markdown">
      {blocks.map((block, index) => (
        <Fragment key={index}>{renderBlock(block)}</Fragment>
      ))}
    </div>
  );
}

function renderBlock(block: Block): ReactNode {
  switch (block.kind) {
    case "heading": {
      // The panel's own title is the h2, so a description heading starts at h3 and the
      // document keeps a logical outline (spec 14).
      const Tag = (["h3", "h4", "h5"] as const)[block.level - 1] ?? "h5";
      return <Tag>{renderInline(block.content)}</Tag>;
    }
    case "paragraph":
      return <p>{renderInline(block.content)}</p>;
    case "quote":
      return <blockquote>{renderInline(block.content)}</blockquote>;
    case "codeBlock":
      return (
        <pre>
          <code>{block.value}</code>
        </pre>
      );
    case "list": {
      const items = block.items.map((item, index) => (
        <li key={index}>{renderInline(item)}</li>
      ));
      return block.ordered ? <ol>{items}</ol> : <ul>{items}</ul>;
    }
  }
}

function renderInline(nodes: readonly InlineNode[]): ReactNode {
  return nodes.map((node, index) => (
    <Fragment key={index}>{renderInlineNode(node)}</Fragment>
  ));
}

function renderInlineNode(node: InlineNode): ReactNode {
  switch (node.kind) {
    case "text":
      return node.value;
    case "code":
      return <code>{node.value}</code>;
    case "strong":
      return <strong>{renderInline(node.children)}</strong>;
    case "emphasis":
      return <em>{renderInline(node.children)}</em>;
    case "link":
      return (
        <a href={node.href} rel="noreferrer noopener" target="_blank">
          {renderInline(node.children)}
        </a>
      );
  }
}
