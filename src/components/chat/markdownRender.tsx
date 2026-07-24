import { Fragment } from "react";

import { Spoiler } from "@/components/chat/Spoiler";
import { parseInline } from "@/lib/markdown";

import type { InlineNode } from "@/lib/markdown";
import type { ReactNode } from "react";

/**
 * Render an inline-markdown AST. Leaf text goes through `renderLeaf`, so the
 * caller keeps its existing plain-text pipeline (custom emoji, search-term
 * highlighting) inside bold/italic/etc. spans.
 */
export function renderInlineNodes(
  nodes: InlineNode[],
  renderLeaf: (text: string) => ReactNode,
  keyPrefix = "",
): ReactNode[] {
  return nodes.map((node, i) => {
    const key = `${keyPrefix}md-${i}`;
    if (node.type === "text") {
      return <Fragment key={key}>{renderLeaf(node.value)}</Fragment>;
    }
    const children = renderInlineNodes(node.children, renderLeaf, `${key}-`);
    switch (node.type) {
      case "strong":
        return <strong key={key} className="font-semibold">{children}</strong>;
      case "em":
        return <em key={key}>{children}</em>;
      case "u":
        return <u key={key} className="underline underline-offset-2">{children}</u>;
      case "s":
        return <s key={key}>{children}</s>;
      case "spoiler":
        return <Spoiler key={key}>{children}</Spoiler>;
    }
  });
}

/** Parse + render a text run's inline markdown in one step. */
export function renderInlineMarkdown(
  text: string,
  renderLeaf: (text: string) => ReactNode,
  keyPrefix = "",
): ReactNode[] {
  return renderInlineNodes(parseInline(text), renderLeaf, keyPrefix);
}
