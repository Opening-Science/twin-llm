import type { Element, ElementContent, Root } from "hast";
import { describe, expect, test } from "bun:test";

import { docTables } from "./doc-tables";

const text = (value: string): ElementContent => ({ type: "text", value });

const element = (tagName: string, children: ElementContent[]): Element => ({
  type: "element",
  tagName,
  properties: {},
  children,
});

/** The tree as a short string: elements as `<tag>`, text as is. */
const flat = (node: Root | ElementContent): string =>
  node.type === "text"
    ? node.value
    : node.type === "element"
      ? `<${node.tagName}>${node.children.map(flat).join("")}`
      : node.type === "root"
        ? node.children.map((child) => flat(child as ElementContent)).join("")
        : "";

const table = (cell: string, code: string): Root => ({
  type: "root",
  children: [
    element("table", [
      element("tbody", [element("tr", [element(cell, [element("code", [text(code)])])])]),
    ]),
  ],
});

describe("docTables", () => {
  test("code in a cell may break after a dot or a slash, nowhere else", () => {
    expect(flat(docTables(table("td", "features/docs/docs-screen.tsx")))).toBe(
      "<div><table><tbody><tr><td><code>features/<wbr>docs/<wbr>docs-screen.<wbr>tsx",
    );
    expect(flat(docTables(table("th", "whoop.recovery.hrv")))).toBe(
      "<div><table><tbody><tr><th><code>whoop.<wbr>recovery.<wbr>hrv",
    );
    // No break after a dot that ends the name, and none inside a word.
    expect(flat(docTables(table("td", "observations_for_subject")))).toBe(
      "<div><table><tbody><tr><td><code>observations_for_subject",
    );
    expect(flat(docTables(table("td", "v1.")))).toBe(
      "<div><table><tbody><tr><td><code>v1.",
    );
  });

  test("every table sits in its own scroll box", () => {
    const out = docTables(table("td", "x"));
    const wrap = out.children[0] as Element;
    expect(wrap.tagName).toBe("div");
    expect(wrap.properties.className).toEqual(["doc-table-wrap"]);
  });

  test("code outside a table, and the input tree, are left alone", () => {
    const tree: Root = {
      type: "root",
      children: [element("p", [element("code", [text("docs/runbook.md")])])],
    };
    const before = JSON.stringify(tree);
    expect(flat(docTables(tree))).toBe("<p><code>docs/runbook.md");
    expect(JSON.stringify(tree)).toBe(before);
    expect(JSON.stringify(docTables(table("td", "a.b")))).not.toBe(
      JSON.stringify(table("td", "a.b")),
    );
  });
});
