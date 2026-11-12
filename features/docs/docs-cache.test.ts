import { describe, expect, test } from "bun:test";

import { cachedDocsFiles, type DocsDisk, renderedByText } from "./docs-cache";
import { listDocPages, readDocPage } from "./docs-pages";

type FakeFile = { text: string; modifiedAt: number };

/** An in-memory `docs/` folder that counts what the cache asks of it. */
const fakeDisk = (initial: Readonly<Record<string, string>>) => {
  const files = new Map<string, FakeFile>(
    Object.entries(initial).map(([path, text]) => [path, { text, modifiedAt: 1 }]),
  );
  const counts = { lists: 0, reads: 0, stats: 0 };
  const disk: DocsDisk = {
    listFiles: async () => {
      counts.lists += 1;
      return [...files.keys()];
    },
    modifiedAt: async (path) => {
      counts.stats += 1;
      return files.get(path)?.modifiedAt ?? null;
    },
    readText: async (path) => {
      counts.reads += 1;
      return files.get(path)?.text ?? null;
    },
  };
  const write = (path: string, text: string) =>
    files.set(path, { text, modifiedAt: (files.get(path)?.modifiedAt ?? 0) + 1 });
  return { disk, counts, write };
};

const FIXTURE = {
  "runbook.md": "# Runbook\n",
  "evaluation/question-set.md": "# Question set\n\nLong page.\n",
};

describe("cachedDocsFiles in production", () => {
  test("lists and reads once; a second call does no reads", async () => {
    const { disk, counts } = fakeDisk(FIXTURE);
    const files = cachedDocsFiles(disk, { revalidate: false });

    const first = await listDocPages(files);
    await readDocPage(files, ["evaluation", "question-set"]);
    expect(counts).toEqual({ lists: 1, reads: 2, stats: 0 });

    expect(await listDocPages(files)).toEqual(first);
    await readDocPage(files, ["evaluation", "question-set"]);
    expect(counts).toEqual({ lists: 1, reads: 2, stats: 0 });
  });

  test("concurrent requests share one read", async () => {
    const { disk, counts } = fakeDisk(FIXTURE);
    const files = cachedDocsFiles(disk, { revalidate: false });
    await Promise.all([files.readText("runbook.md"), files.readText("runbook.md")]);
    expect(counts.reads).toBe(1);
  });

  test("keeps serving the first read after the file changes", async () => {
    const { disk, counts, write } = fakeDisk(FIXTURE);
    const files = cachedDocsFiles(disk, { revalidate: false });
    await files.readText("runbook.md");
    write("runbook.md", "# Changed\n");
    expect(await files.readText("runbook.md")).toBe("# Runbook\n");
    expect(counts.reads).toBe(1);
  });

  test("a failed read is not cached", async () => {
    const { disk } = fakeDisk(FIXTURE);
    const failures = { left: 1 };
    const flaky: DocsDisk = {
      ...disk,
      readText: async (path) => {
        if (failures.left-- > 0) throw new Error("EIO");
        return disk.readText(path);
      },
    };
    const files = cachedDocsFiles(flaky, { revalidate: false });
    await expect(files.readText("runbook.md")).rejects.toThrow("EIO");
    expect(await files.readText("runbook.md")).toBe("# Runbook\n");
  });
});

describe("cachedDocsFiles in development", () => {
  test("a second call with unchanged files does no reads", async () => {
    const { disk, counts } = fakeDisk(FIXTURE);
    const files = cachedDocsFiles(disk, { revalidate: true });
    await listDocPages(files);
    expect(counts.reads).toBe(2);

    await listDocPages(files);
    await readDocPage(files, ["runbook"]);
    expect(counts.reads).toBe(2);
  });

  test("an mtime change triggers exactly one re-read", async () => {
    const { disk, counts, write } = fakeDisk(FIXTURE);
    const files = cachedDocsFiles(disk, { revalidate: true });
    await listDocPages(files);
    write("runbook.md", "# Runbook, revised\n");

    const pages = await listDocPages(files);
    expect(pages.find((page) => page.path === "runbook.md")?.title).toBe(
      "Runbook, revised",
    );
    expect(counts.reads).toBe(3);

    await readDocPage(files, ["runbook"]);
    expect(counts.reads).toBe(3);
  });

  test("a new page shows up and a missing one reads as null without a read", async () => {
    const { disk, counts, write } = fakeDisk(FIXTURE);
    const files = cachedDocsFiles(disk, { revalidate: true });
    await listDocPages(files);
    write("privacy-design.md", "# Privacy design\n");
    expect((await listDocPages(files)).map((page) => page.slug)).toContain(
      "privacy-design",
    );
    expect(await files.readText("missing.md")).toBeNull();
    expect(counts.reads).toBe(3);
  });
});

describe("renderedByText", () => {
  /** Reads a page through the cache and renders it, counting renders. */
  const renderer = (files: ReturnType<typeof cachedDocsFiles>) => {
    const rendered = renderedByText<string>();
    const counts = { renders: 0 };
    const render = (text: string) => {
      counts.renders += 1;
      return text.toUpperCase();
    };
    const show = async (slug: readonly string[]) => {
      const page = await readDocPage(files, slug);
      return page && rendered(`app:${page.path}`, page.markdown, render);
    };
    return { show, counts };
  };

  test("in production a second request does no render", async () => {
    const { disk } = fakeDisk(FIXTURE);
    const { show, counts } = renderer(cachedDocsFiles(disk, { revalidate: false }));
    expect(await show(["runbook"])).toBe("# RUNBOOK\n");
    expect(await show(["runbook"])).toBe("# RUNBOOK\n");
    expect(counts.renders).toBe(1);
  });

  test("in development an mtime change gives exactly one re-render", async () => {
    const { disk, write } = fakeDisk(FIXTURE);
    const { show, counts } = renderer(cachedDocsFiles(disk, { revalidate: true }));
    await show(["runbook"]);
    await show(["runbook"]);
    expect(counts.renders).toBe(1);

    write("runbook.md", "# Runbook, revised\n");
    expect(await show(["runbook"])).toBe("# RUNBOOK, REVISED\n");
    await show(["runbook"]);
    expect(counts.renders).toBe(2);
  });

  test("keys apart the same page in two link styles", () => {
    const rendered = renderedByText<string>();
    const counts = { renders: 0 };
    const render = (text: string) => {
      counts.renders += 1;
      return text;
    };
    rendered("app:runbook.md", "# Runbook\n", render);
    rendered("github:runbook.md", "# Runbook\n", render);
    expect(counts.renders).toBe(2);
  });
});
