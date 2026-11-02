import { describe, expect, test } from "bun:test";

import { brokenLinks, extractLinks, headingAnchors, type LinkFiles } from "./check-links";

const pages: Readonly<Record<string, string>> = {
  "docs/providers.md":
    "# LLM providers\n\n## What leaves the host\n\n## Tool: `gbd_estimate`\n\n## Notes\n\n## Notes\n",
  "docs/images/chat.png": "",
  LICENSE: "",
};

const files: LinkFiles = {
  exists: (path) => path in pages,
  readText: (path) => pages[path] ?? null,
};

describe("extractLinks", () => {
  test("finds Markdown links, images and HTML attributes with their lines", () => {
    const markdown = [
      "See [providers](docs/providers.md#what-leaves-the-host).",
      '![chart](docs/images/chat.png "Chart")',
      '<source srcset="docs/images/a.png 1x, docs/images/b.png 2x"><img src="docs/images/chat.png">',
    ].join("\n");
    expect(extractLinks(markdown)).toEqual([
      { line: 1, target: "docs/providers.md#what-leaves-the-host" },
      { line: 2, target: "docs/images/chat.png" },
      { line: 3, target: "docs/images/chat.png" },
      { line: 3, target: "docs/images/a.png" },
      { line: 3, target: "docs/images/b.png" },
    ]);
  });

  test("skips fenced code and inline code", () => {
    const markdown = "```\n[a](nope.md)\n```\nRun `[b](nope.md)` here.";
    expect(extractLinks(markdown)).toEqual([]);
  });
});

describe("headingAnchors", () => {
  test("follows GitHub's slugs, without code marks, and numbers repeats", () => {
    const anchors = headingAnchors(pages["docs/providers.md"] ?? "");
    expect([...anchors]).toEqual([
      "llm-providers",
      "what-leaves-the-host",
      "tool-gbd_estimate",
      "notes",
      "notes-1",
    ]);
  });

  test("ignores headings inside fenced code", () => {
    expect([...headingAnchors("```bash\n# a comment\n```\n## Real")]).toEqual(["real"]);
  });
});

describe("brokenLinks", () => {
  test("accepts existing files, headings and external or absolute links", () => {
    const markdown = [
      "[a](providers.md) [b](providers.md#notes-1) [c](../LICENSE)",
      "[d](https://example.org/x.md) [e](/lab) [f](mailto:x@example.org) [g](#llm-providers)",
    ].join("\n");
    expect(brokenLinks("docs/providers.md", markdown, files)).toEqual([]);
  });

  test("reports a missing file, a missing heading and a path above the root", () => {
    const markdown = "[a](docs/gone.md)\n[b](docs/providers.md#nope)\n[c](../outside.md)";
    expect(brokenLinks("README.md", markdown, files)).toEqual([
      { file: "README.md", line: 1, target: "docs/gone.md", reason: "missing file" },
      {
        file: "README.md",
        line: 2,
        target: "docs/providers.md#nope",
        reason: "missing heading",
      },
      { file: "README.md", line: 3, target: "../outside.md", reason: "missing file" },
    ]);
  });

  test("does not check headings in files that are not Markdown", () => {
    expect(brokenLinks("README.md", "[a](LICENSE#L3)", files)).toEqual([]);
  });
});
