import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { headingSlug } from "../../features/docs/heading-ids";

/**
 * Checks that every relative link in the repository's Markdown pages points
 * at a file that exists and, for a link to a Markdown heading, at a heading
 * that exists. External links (`https:`, `mailto:`) and absolute paths (app
 * routes such as `/lab`) are not checked in Markdown. The app's own links to
 * a docs page (`/docs/runbook#encryption-at-rest` in `app/` and `features/`)
 * are checked the same way, so renaming a heading cannot strand a link in a
 * screen. Run with `bun run lint:links`.
 */

export type MarkdownLink = Readonly<{ line: number; target: string }>;

export type BrokenLink = Readonly<{
  file: string;
  line: number;
  target: string;
  reason: "missing file" | "missing heading";
}>;

const FENCE = /^\s*(```|~~~)/;
const INLINE_CODE = /`[^`]*`/g;
const MD_LINK = /!?\[[^\]]*\]\(\s*(<[^>]*>|[^\s)]+)(?:\s+"[^"]*")?\s*\)/g;
const HTML_ATTR = /\b(?:href|src)="([^"]+)"/g;
const SRCSET = /\bsrcset="([^"]+)"/g;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

/** Links on lines outside fenced code blocks and inline code, in page order. */
export const extractLinks = (markdown: string): readonly MarkdownLink[] => {
  const links: MarkdownLink[] = [];
  let inFence = false;
  markdown.split("\n").forEach((raw, index) => {
    if (FENCE.test(raw)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const text = raw.replace(INLINE_CODE, "");
    const line = index + 1;
    for (const match of text.matchAll(MD_LINK)) {
      const target = (match[1] ?? "").replace(/^<|>$/g, "");
      links.push({ line, target });
    }
    for (const match of text.matchAll(HTML_ATTR))
      links.push({ line, target: match[1] ?? "" });
    for (const match of text.matchAll(SRCSET))
      for (const part of (match[1] ?? "").split(",")) {
        const target = part.trim().split(/\s+/)[0] ?? "";
        if (target !== "") links.push({ line, target });
      }
  });
  return links;
};

/** The text a heading shows once its Markdown is rendered. */
const headingText = (source: string): string =>
  source
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`/g, "")
    .replace(/\*+/g, "")
    .trim();

/** GitHub's anchors for every heading of a page, with `-1`, `-2` for repeats. */
export const headingAnchors = (markdown: string): ReadonlySet<string> => {
  const seen = new Map<string, number>();
  const anchors = new Set<string>();
  let inFence = false;
  for (const line of markdown.split("\n")) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const heading = /^#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      const slug = headingSlug(headingText(heading[1] ?? ""));
      const count = seen.get(slug) ?? 0;
      seen.set(slug, count + 1);
      anchors.add(count === 0 ? slug : `${slug}-${count}`);
    }
    for (const match of line.matchAll(/<a\s+(?:id|name)="([^"]+)"/g))
      anchors.add(match[1] ?? "");
  }
  return anchors;
};

export type LinkFiles = Readonly<{
  /** True when the repository path (posix, relative to the root) exists. */
  exists: (path: string) => boolean;
  /** Text of a Markdown file in the repository, or null when there is none. */
  readText: (path: string) => string | null;
}>;

const safeDecode = (value: string): string => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

/** The broken relative links of one page at `file` (posix, relative to the root). */
export const brokenLinks = (
  file: string,
  markdown: string,
  files: LinkFiles,
): readonly BrokenLink[] =>
  extractLinks(markdown).flatMap(({ line, target }): BrokenLink[] => {
    if (target === "" || EXTERNAL.test(target)) return [];
    const [pathPart = "", hash] = target.split("#", 2);
    const path =
      pathPart === ""
        ? file
        : posix.normalize(
            posix.join(posix.dirname(file), safeDecode(pathPart.split("?")[0] ?? "")),
          );
    if (path.startsWith("../") || !files.exists(path))
      return [{ file, line, target, reason: "missing file" }];
    if (hash === undefined || hash === "" || !path.endsWith(".md")) return [];
    const text = files.readText(path);
    if (text === null || headingAnchors(text).has(safeDecode(hash).toLowerCase()))
      return [];
    return [{ file, line, target, reason: "missing heading" }];
  });

/** A link from the app's code to a docs page: `/docs/runbook#encryption-at-rest`. */
export type AppDocLink = Readonly<{
  line: number;
  slug: string;
  hash: string | undefined;
}>;

const APP_DOC_LINK = /["'`]\/docs\/([a-z0-9-]+(?:\/[a-z0-9-]+)*)(?:#([^"'`\s]+))?["'`]/g;

/**
 * The `/docs/...` links written out in full in a source file. A link built
 * from a value (`/docs/${page.slug}`) is not written out and is not checked.
 */
export const extractAppDocLinks = (source: string): readonly AppDocLink[] =>
  source.split("\n").flatMap((text, index) =>
    [...text.matchAll(APP_DOC_LINK)].map((match) => ({
      line: index + 1,
      slug: match[1] ?? "",
      hash: match[2],
    })),
  );

/**
 * The app's links in the source `file` that reach no docs page, or no heading
 * on it. The docs route serves `docs/<slug>.md` with the same heading ids as
 * GitHub, so the same anchors are checked.
 */
export const brokenAppDocLinks = (
  file: string,
  source: string,
  files: LinkFiles,
): readonly BrokenLink[] =>
  extractAppDocLinks(source).flatMap(({ line, slug, hash }): BrokenLink[] => {
    const target = `/docs/${slug}${hash === undefined ? "" : `#${hash}`}`;
    const text = files.readText(`docs/${slug}.md`);
    if (text === null) return [{ file, line, target, reason: "missing file" }];
    if (hash === undefined || headingAnchors(text).has(safeDecode(hash).toLowerCase()))
      return [];
    return [{ file, line, target, reason: "missing heading" }];
  });

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const toPosix = (path: string): string => path.split(sep).join("/");

/** Folders whose Markdown is not a page: installed packages, build output, test fixtures. */
const NOT_PAGES = /(?:^|\/)(?:node_modules|dist|\.next|fixtures|research-fixtures)\//;

const markdownUnder = (dir: string): string[] =>
  existsSync(join(ROOT, dir))
    ? readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
        .map((entry) => toPosix(relative(ROOT, join(entry.parentPath, entry.name))))
        .filter((path) => !NOT_PAGES.test(path))
    : [];

/**
 * The other folders with Markdown pages a person reads: skills, the knowledge
 * notes, READMEs beside code and data, the pull request template.
 */
const PAGE_FOLDERS = [
  ".github",
  "apps",
  "evaluation",
  "features",
  "knowledge",
  "packages",
  "public",
  "python",
  "scripts",
  "skills",
] as const;

/**
 * The pages checked: the Markdown files at the root, everything under `docs/`
 * and the pages in `PAGE_FOLDERS`.
 */
export const pagesToCheck = (): readonly string[] => [
  ...readdirSync(ROOT)
    .filter((name) => name.endsWith(".md") && statSync(join(ROOT, name)).isFile())
    .sort(),
  ...markdownUnder("docs").sort(),
  ...PAGE_FOLDERS.flatMap(markdownUnder).sort(),
];

const SOURCE = /\.tsx?$/;
const TEST = /\.test\.tsx?$|\.test-helpers\.ts$/;

/** The app's source files that can link to a docs page: `app/` and `features/`, not tests. */
export const sourcesToCheck = (): readonly string[] =>
  ["app", "features"]
    .flatMap((dir) =>
      readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
        .filter(
          (entry) => entry.isFile() && SOURCE.test(entry.name) && !TEST.test(entry.name),
        )
        .map((entry) => toPosix(relative(ROOT, join(entry.parentPath, entry.name)))),
    )
    .sort();

const repoFiles: LinkFiles = {
  exists: (path) => existsSync(join(ROOT, path)),
  readText: (path) =>
    existsSync(join(ROOT, path)) ? readFileSync(join(ROOT, path), "utf8") : null,
};

if ((import.meta as { main?: boolean }).main) {
  const pages = pagesToCheck();
  const sources = sourcesToCheck();
  const broken = [
    ...pages.flatMap((file) =>
      brokenLinks(file, readFileSync(join(ROOT, file), "utf8"), repoFiles),
    ),
    ...sources.flatMap((file) =>
      brokenAppDocLinks(file, readFileSync(join(ROOT, file), "utf8"), repoFiles),
    ),
  ];
  for (const link of broken)
    console.error(`${link.file}:${link.line}  ${link.target}  (${link.reason})`);
  console.log(
    `lint:links: ${pages.length} pages, ${sources.length} source files, ${broken.length} broken links`,
  );
  if (broken.length > 0) process.exit(1);
}
