import { readFile } from "node:fs/promises";
import { join } from "node:path";

import type { Root } from "hast";
import { describe, expect, test } from "bun:test";

import { addHeadingIds, headingSlug } from "./heading-ids";

const heading = (tagName: string, text: string) => ({
  type: "element" as const,
  tagName,
  properties: {},
  children: [{ type: "text" as const, value: text }],
});

const idsOf = (tree: Root): unknown[] =>
  tree.children.map((child) => (child.type === "element" ? child.properties.id : null));

describe("headingSlug", () => {
  test("matches GitHub's anchors", () => {
    expect(headingSlug("Local-only mode")).toBe("local-only-mode");
    expect(headingSlug("Literature (#236)")).toBe("literature-236");
    expect(headingSlug("What leaves the host")).toBe("what-leaves-the-host");
    expect(headingSlug("Ollama `num_ctx`")).toBe("ollama-num_ctx");
  });
});

describe("addHeadingIds", () => {
  test("gives each heading an id, numbering repeats, and leaves the input alone", () => {
    const tree: Root = {
      type: "root",
      children: [
        heading("h1", "LLM providers"),
        heading("h2", "Setup"),
        { type: "element", tagName: "p", properties: {}, children: [] },
        heading("h3", "Setup"),
      ],
    };
    expect(idsOf(addHeadingIds(tree))).toEqual([
      "llm-providers",
      "setup",
      undefined,
      "setup-1",
    ]);
    expect(idsOf(tree)).toEqual([undefined, undefined, undefined, undefined]);
  });

  test("reads text inside inline code and links", () => {
    const tree: Root = {
      type: "root",
      children: [
        {
          type: "element",
          tagName: "h2",
          properties: {},
          children: [
            { type: "text", value: "The " },
            {
              type: "element",
              tagName: "code",
              properties: {},
              children: [{ type: "text", value: "LOCAL_ONLY" }],
            },
            { type: "text", value: " switch" },
          ],
        },
      ],
    };
    expect(idsOf(addHeadingIds(tree))).toEqual(["the-local_only-switch"]);
  });

  test("the Lab page's link target exists in docs/providers.md", async () => {
    const text = await readFile(join(import.meta.dir, "../../docs/providers.md"), "utf8");
    const slugs = [...text.matchAll(/^#{1,6} (.+)$/gm)].map((match) =>
      headingSlug(match[1]),
    );
    expect(slugs).toContain("local-only-mode");
  });
});
