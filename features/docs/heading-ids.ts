import type { Element, ElementContent, Root, RootContent } from "hast";

/**
 * Heading ids for the rendered docs, so a link such as
 * `/docs/providers#local-only-mode` lands on its section. Slugs follow
 * GitHub's rule (lower case, punctuation dropped, each space a hyphen, a
 * repeat gets `-1`, `-2`), so the same anchors work on GitHub and here.
 */

/** GitHub's anchor for one heading's text. */
export const headingSlug = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N} _-]/gu, "")
    .replace(/ /g, "-");

const HEADING = /^h[1-6]$/;

type Node = Root | RootContent | ElementContent;

const textOf = (node: Node): string =>
  node.type === "text"
    ? node.value
    : "children" in node
      ? node.children.map((child) => textOf(child)).join("")
      : "";

const withIds = <T extends Node>(node: T, seen: Map<string, number>): T => {
  if (node.type === "element" && HEADING.test(node.tagName)) {
    const slug = headingSlug(textOf(node));
    const count = seen.get(slug) ?? 0;
    seen.set(slug, count + 1);
    const id = count === 0 ? slug : `${slug}-${count}`;
    const heading: Element = {
      ...node,
      properties: { ...node.properties, id: node.properties.id ?? id },
    };
    return heading as T;
  }
  if (node.type === "root" || node.type === "element") {
    return {
      ...node,
      children: node.children.map((child) => withIds(child, seen)),
    };
  }
  return node;
};

/** A copy of the tree with an id on every heading that has none. */
export const addHeadingIds = (tree: Root): Root => withIds(tree, new Map());

/** The rehype plugin for react-markdown. */
export const rehypeHeadingIds = () => addHeadingIds;
