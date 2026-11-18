import type { Element, ElementContent, Root, RootContent } from "hast";

/**
 * Tables in the rendered docs, so a phone can read them. Code names in a cell (`features/docs/docs-screen.tsx`,
 * `whoop.recovery.hrv`) may break only after a dot or a slash, never inside
 * a word: each gets a `<wbr>` there, and `.doc-prose` lets table code wrap
 * nowhere else. A table that is still too wide scrolls inside its own box
 * (`.doc-table-wrap`), never the page.
 */

type Node = Root | RootContent | ElementContent;

const CELL = new Set(["td", "th"]);

/** After each `.` or `/` that has more text after it. */
const BREAK_AFTER = /(?<=[./])(?=.)/;

const WBR: Element = { type: "element", tagName: "wbr", properties: {}, children: [] };

/** A code element's text with a `<wbr>` after every dot and slash. */
const withBreaks = (code: Element): Element => ({
  ...code,
  children: code.children.flatMap((child): ElementContent[] =>
    child.type === "text"
      ? child.value
          .split(BREAK_AFTER)
          .flatMap((part, index) =>
            index === 0
              ? [{ type: "text", value: part }]
              : [WBR, { type: "text", value: part }],
          )
      : [child],
  ),
});

const visit = <T extends Node>(node: T, inCell: boolean): T => {
  if (node.type === "element") {
    if (inCell && node.tagName === "code") return withBreaks(node) as T;
    const children = node.children.map((child) =>
      visit(child, inCell || CELL.has(node.tagName)),
    );
    if (node.tagName === "table") {
      const wrap: Element = {
        type: "element",
        tagName: "div",
        properties: { className: ["doc-table-wrap"] },
        children: [{ ...node, children }],
      };
      return wrap as T;
    }
    return { ...node, children };
  }
  if (node.type === "root") {
    return { ...node, children: node.children.map((child) => visit(child, inCell)) };
  }
  return node;
};

/** A copy of the tree with every table boxed and its code names breakable at dots and slashes. */
export const docTables = (tree: Root): Root => visit(tree, false);

/** The rehype plugin for react-markdown. */
export const rehypeDocTables = () => docTables;
