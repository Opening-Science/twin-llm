import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import {
  brokenAppDocLinks,
  brokenLinks,
  extractAppDocLinks,
  extractLinks,
  headingAnchors,
  type LinkFiles,
  pagesToCheck,
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
    const source = 'href={`/docs/${page.slug}`} href="/docs" href="/lab/docs/x"';
    expect(extractAppDocLinks(source)).toEqual([]);
  });
});

describe("brokenAppDocLinks", () => {
  test("accepts a page and a heading on it", () => {
    const source =
      '"/docs/providers" "/docs/providers#what-leaves-the-host" "/docs/providers#notes-1"';
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

describe("pagesToCheck", () => {
  test("reads the root, the docs and the pages beside code, skills and data", () => {
    const pages = pagesToCheck();
    for (const page of [
      "README.md",
      "docs/runbook.md",
      "skills/sleep/SKILL.md",
      "knowledge/opentwin/metric-glossary.md",
      "public/fonts/README.md",
      "python/README.md",
      ".github/pull_request_template.md",
    ])
      expect(pages).toContain(page);
  });

  test("misses no folder: every page in the repository is read", () => {
    // Hidden folders other than .github (worktrees, caches, local plans) and
    // generated or installed ones hold no pages of the repository.
    const skip = (name: string) =>
      (name.startsWith(".") && name !== ".github") ||
      name === "generated" ||
      name === "node_modules";
    const root = join(import.meta.dir, "..", "..");
    const pages = new Set(pagesToCheck());
    const found = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !skip(entry.name))
      .flatMap((dir) =>
        readdirSync(join(root, dir.name), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) =>
            relative(root, join(entry.parentPath, entry.name)).split(sep).join("/"),
          ),
      )
      .filter(
        (path) =>
          !/(?:^|\/)(?:node_modules|dist|fixtures|research-fixtures)\//.test(path),
      );
    expect(found.filter((path) => !pages.has(path))).toEqual([]);
  });

  test("leaves out test fixtures and installed packages", () => {
    const pages = pagesToCheck();
    expect(pages.some((page) => page.includes("fixtures/"))).toBe(false);
    expect(pages.some((page) => page.includes("node_modules/"))).toBe(false);
  });
});
