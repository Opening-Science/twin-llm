import { describe, expect, test } from "bun:test";

import {
  docImageFile,
  docPathForSlug,
  type DocsFiles,
  listDocPages,
  readDocPage,
  rewriteDocUrl,
} from "./docs-pages";

const FIXTURE: Readonly<Record<string, string>> = {
  "runbook.md": "# Runbook\n\nHow to run it.\n",
  "providers.md": "Intro line first.\n\n# LLM providers\n",
  "evaluation/harness.md": "# Evaluation harness\n",
  "untitled.md": "No heading here.\n",
};

const files: DocsFiles = {
  listFiles: async () => [...Object.keys(FIXTURE), "images/start-light.png", "notes.txt"],
  readText: async (path) => FIXTURE[path] ?? null,
};

describe("docPathForSlug", () => {
  test("maps a slug to its Markdown file", () => {
    expect(docPathForSlug(["runbook"])).toBe("runbook.md");
    expect(docPathForSlug(["evaluation", "harness"])).toBe("evaluation/harness.md");
    expect(docPathForSlug(["open-twin-pins"])).toBe("open-twin-pins.md");
  });

  test("refuses traversal, extensions, and anything but kebab-case", () => {
    expect(docPathForSlug([])).toBeNull();
    expect(docPathForSlug([".."])).toBeNull();
    expect(docPathForSlug(["..", "package"])).toBeNull();
    expect(docPathForSlug(["evaluation", "..", "..", "README"])).toBeNull();
    expect(docPathForSlug(["runbook.md"])).toBeNull();
    expect(docPathForSlug(["Runbook"])).toBeNull();
    expect(docPathForSlug(["%2e%2e"])).toBeNull();
    expect(docPathForSlug(["-leading"])).toBeNull();
  });
});

describe("docImageFile", () => {
  test("allows png, jpg and svg names under images/", () => {
    expect(docImageFile("compare-light.png")).toEqual({
      path: "images/compare-light.png",
      contentType: "image/png",
    });
    expect(docImageFile("photo.jpg")).toEqual({
      path: "images/photo.jpg",
      contentType: "image/jpeg",
    });
    expect(docImageFile("flow.svg")).toEqual({
      path: "images/flow.svg",
      contentType: "image/svg+xml",
    });
  });

  test("refuses other extensions and traversal", () => {
    expect(docImageFile("notes.md")).toBeNull();
    expect(docImageFile("../runbook.md")).toBeNull();
    expect(docImageFile("..%2F.env.local")).toBeNull();
    expect(docImageFile("a/b.png")).toBeNull();
    expect(docImageFile("")).toBeNull();
  });
});

describe("rewriteDocUrl for a standalone page", () => {
  test("sends other pages to GitHub", () => {
    expect(
      rewriteDocUrl("training-data.md#the-1m-cohort", "synthea-generator.md", "github"),
    ).toBe(
      "https://github.com/Opening-Science/twin-llm/blob/main/docs/training-data.md#the-1m-cohort",
    );
    expect(rewriteDocUrl("../NOTICE", "synthea-generator.md", "github")).toBe(
      "https://github.com/Opening-Science/twin-llm/blob/main/NOTICE",
    );
  });
});

describe("rewriteDocUrl", () => {
  test("sibling and nested Markdown links become /docs routes", () => {
    expect(rewriteDocUrl("providers.md", "twin-llm.md")).toBe("/docs/providers");
    expect(rewriteDocUrl("./vitronic.md", "vitronic-endpoints.md")).toBe(
      "/docs/vitronic",
    );
    expect(rewriteDocUrl("evaluation/harness.md", "runbook.md")).toBe(
      "/docs/evaluation/harness",
    );
    expect(rewriteDocUrl("../runbook.md#remote-gpu", "evaluation/harness.md")).toBe(
      "/docs/runbook#remote-gpu",
    );
    expect(rewriteDocUrl("providers.md#exoscale", "twin-llm.md")).toBe(
      "/docs/providers#exoscale",
    );
  });

  test("links out of docs/ go to the file on GitHub", () => {
    expect(rewriteDocUrl("../README.md", "runbook.md")).toBe(
      "https://github.com/Opening-Science/twin-llm/blob/main/README.md",
    );
    expect(rewriteDocUrl("../../CONTRIBUTING.md#setup", "evaluation/harness.md")).toBe(
      "https://github.com/Opening-Science/twin-llm/blob/main/CONTRIBUTING.md#setup",
    );
    expect(rewriteDocUrl("claims-allowlist.json", "runbook.md")).toBe(
      "https://github.com/Opening-Science/twin-llm/blob/main/docs/claims-allowlist.json",
    );
    expect(rewriteDocUrl("diagrams/data-flow.svg", "twin-llm.md")).toBe(
      "https://github.com/Opening-Science/twin-llm/blob/main/docs/diagrams/data-flow.svg",
    );
  });

  test("images under docs/images/ are served by the image route", () => {
    expect(rewriteDocUrl("images/start-light.png", "twin-llm.md")).toBe(
      "/docs/images/start-light.png",
    );
    expect(rewriteDocUrl("../images/start-light.png", "evaluation/harness.md")).toBe(
      "/docs/images/start-light.png",
    );
  });

  test("absolute, anchor and empty links stay as written", () => {
    expect(rewriteDocUrl("https://loinc.org/license/", "biomarkers.md")).toBe(
      "https://loinc.org/license/",
    );
    expect(rewriteDocUrl("mailto:hello@example.org", "runbook.md")).toBe(
      "mailto:hello@example.org",
    );
    expect(rewriteDocUrl("#sources", "gbd.md")).toBe("#sources");
    expect(rewriteDocUrl("", "gbd.md")).toBe("");
  });
});

describe("listDocPages", () => {
  test("lists every Markdown file with its H1, sorted by path", async () => {
    expect(await listDocPages(files)).toEqual([
      {
        slug: "evaluation/harness",
        path: "evaluation/harness.md",
        title: "Evaluation harness",
      },
      { slug: "providers", path: "providers.md", title: "LLM providers" },
      { slug: "runbook", path: "runbook.md", title: "Runbook" },
      { slug: "untitled", path: "untitled.md", title: "untitled" },
    ]);
  });
});

describe("readDocPage", () => {
  test("returns the page with its title and text", async () => {
    expect(await readDocPage(files, ["evaluation", "harness"])).toEqual({
      slug: "evaluation/harness",
      path: "evaluation/harness.md",
      title: "Evaluation harness",
      markdown: "# Evaluation harness\n",
    });
  });

  test("returns null for an unknown page or a traversal attempt", async () => {
    expect(await readDocPage(files, ["missing"])).toBeNull();
    expect(await readDocPage(files, ["..", "README"])).toBeNull();
  });
});
