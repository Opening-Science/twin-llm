import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  brokenAppDocLinks,
  brokenLinks,
  extractAppDocLinks,
  extractLinks,
  headingAnchors,
  type LinkFiles,
  sourcesToCheck,
} from "./check-links";

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

describe("extractAppDocLinks", () => {
  test("finds docs links written out in full, with their lines and anchors", () => {
    const source = [
      'const a = { href: "/docs/providers#local-only-mode" };',
      "<Link href='/docs/evaluation/harness'>x</Link>",
      "const b = `/docs/runbook`;",
    ].join("\n");
    expect(extractAppDocLinks(source)).toEqual([
      { line: 1, slug: "providers", hash: "local-only-mode" },
      { line: 2, slug: "evaluation/harness", hash: undefined },
      { line: 3, slug: "runbook", hash: undefined },
    ]);
  });

  test("skips links built from a value and other routes", () => {
    const source =
      'href={`/docs/${page.slug}`} href="/docs" href="/lab/docs/x" `/docs/...`';
    expect(extractAppDocLinks(source)).toEqual([]);
  });
});

describe("brokenAppDocLinks", () => {
  test("accepts a page, a heading on it and an image", () => {
    const source =
      '"/docs/providers" "/docs/providers#what-leaves-the-host" "/docs/providers#notes-1" "/docs/images/chat.png"';
    expect(brokenAppDocLinks("features/x.ts", source, files)).toEqual([]);
  });

  test("reports a missing page and a missing heading", () => {
    const source = 'a = "/docs/gone";\nb = "/docs/providers#nope";';
    expect(brokenAppDocLinks("features/x.ts", source, files)).toEqual([
      { file: "features/x.ts", line: 1, target: "/docs/gone", reason: "missing file" },
      {
        file: "features/x.ts",
        line: 2,
        target: "/docs/providers#nope",
        reason: "missing heading",
      },
    ]);
  });

  test("reports a spelling the docs route refuses, even when the file exists", () => {
    const source = '"/docs/Providers"\n"/docs/providers.md"\n"/docs/-providers"';
    expect(
      brokenAppDocLinks("features/x.ts", source, files).map(({ line, reason }) => ({
        line,
        reason,
      })),
    ).toEqual([
      { line: 1, reason: "not a docs route" },
      { line: 2, reason: "not a docs route" },
      { line: 3, reason: "not a docs route" },
    ]);
  });
});

describe("the app's docs links", () => {
  test("every page and heading they name exists", () => {
    const root = join(import.meta.dir, "..", "..");
    const repo: LinkFiles = {
      exists: (path) => existsSync(join(root, path)),
      readText: (path) =>
        existsSync(join(root, path)) ? readFileSync(join(root, path), "utf8") : null,
    };
    const sources = sourcesToCheck();
    expect(sources).toContain("features/lab/encryption-check.ts");
    expect(sources.some((file) => file.endsWith(".test.ts"))).toBe(false);
    const broken = sources.flatMap((file) =>
      brokenAppDocLinks(file, readFileSync(join(root, file), "utf8"), repo),
    );
    expect(broken).toEqual([]);
  });
});
