import "server-only";

import { readdir, readFile } from "node:fs/promises";
import { join, posix, relative, resolve, sep } from "node:path";

/**
 * The reference pages under `docs/`, served in the app. A slug is the file
 * path without `.md` (`evaluation/harness`); every segment must be a plain
 * kebab-case word, so the only files reachable are the Markdown pages and the
 * images the route handler allows. Reads come in as `DocsFiles` so tests pass
 * a fake.
 */

export const DOCS_DIR = "docs";
export const REPO_URL = "https://github.com/Opening-Science/twin-llm";

export type DocsFiles = Readonly<{
  /** Paths relative to `docs/`, posix separators. */
  listFiles: () => Promise<readonly string[]>;
  /** Text of a file relative to `docs/`, or null when it does not exist. */
  readText: (path: string) => Promise<string | null>;
}>;

export type DocPage = Readonly<{ slug: string; path: string; title: string }>;

const SEGMENT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const IMAGE_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*\.(png|jpg|svg)$/;
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
};

/** `["evaluation", "harness"]` → `evaluation/harness.md`; anything else null. */
export const docPathForSlug = (slug: readonly string[]): string | null => {
  if (slug.length === 0 || !slug.every((segment) => SEGMENT.test(segment))) return null;
  return `${slug.join("/")}.md`;
};

export const docImageFile = (
  name: string,
): Readonly<{ path: string; contentType: string }> | null => {
  const match = IMAGE_NAME.exec(name);
  const type = match ? IMAGE_TYPES[match[1] ?? ""] : undefined;
  return type ? { path: `images/${name}`, contentType: type } : null;
};

export const docTitle = (markdown: string, path: string): string =>
  /^#\s+(.+?)\s*$/m.exec(markdown)?.[1] ?? path.replace(/\.md$/, "");

const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/\/|#)/i;

/**
 * Where a link or image in the page at `fromPath` should point in the app.
 * Markdown pages inside `docs/` become `/docs/...` routes, images under
 * `docs/images/` are served by the image route, and everything else, such as
 * `../README.md`, goes to the file on GitHub. With `pages: "github"` other
 * Markdown pages go to GitHub too, for a page shown outside the app's docs
 * (the Synthea generator's own host serves no other page).
 */
export const rewriteDocUrl = (
  url: string,
  fromPath: string,
  pages: "app" | "github" = "app",
): string => {
  if (url === "" || EXTERNAL.test(url)) return url;
  const [target = "", hash] = url.split("#", 2);
  const anchor = hash === undefined ? "" : `#${hash}`;
  if (target === "") return url;
  const path = posix.normalize(posix.join(posix.dirname(fromPath), target));
  if (path.startsWith("../")) return `${REPO_URL}/blob/main/${path.slice(3)}${anchor}`;
  if (path.endsWith(".md") && pages === "app")
    return `/docs/${path.slice(0, -3)}${anchor}`;
  if (/^images\/[^/]+$/.test(path)) return `/${DOCS_DIR}/${path}`;
  return `${REPO_URL}/blob/main/${DOCS_DIR}/${path}${anchor}`;
};

export const listDocPages = async (files: DocsFiles): Promise<readonly DocPage[]> => {
  const paths = (await files.listFiles()).filter((path) => path.endsWith(".md")).sort();
  const pages = await Promise.all(
    paths.map(async (path) => {
      const text = await files.readText(path);
      return { slug: path.slice(0, -3), path, title: docTitle(text ?? "", path) };
    }),
  );
  return pages;
};

export const readDocPage = async (
  files: DocsFiles,
  slug: readonly string[],
): Promise<(DocPage & Readonly<{ markdown: string }>) | null> => {
  const path = docPathForSlug(slug);
  if (path === null) return null;
  const markdown = await files.readText(path);
  if (markdown === null) return null;
  return { slug: slug.join("/"), path, title: docTitle(markdown, path), markdown };
};

const isMissing = (error: unknown): boolean =>
  error instanceof Error && Reflect.get(error, "code") === "ENOENT";

const docsRoot = () => resolve(process.cwd(), DOCS_DIR);

/** Absolute path of a file under `docs/`, or null when it would leave the folder. */
const inDocs = (path: string): string | null => {
  const root = docsRoot();
  const full = resolve(root, path);
  return full.startsWith(`${root}${sep}`) ? full : null;
};

export const docsFiles: DocsFiles = {
  listFiles: async () => {
    const entries = await readdir(docsRoot(), { recursive: true, withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile())
      .map((entry) =>
        relative(docsRoot(), join(entry.parentPath, entry.name)).split(sep).join("/"),
      );
  },
  readText: async (path) => {
    const full = inDocs(path);
    if (full === null) return null;
    try {
      return await readFile(full, "utf8");
    } catch (error) {
      if (isMissing(error)) return null;
      throw error;
    }
  },
};

export const readDocImage = async (
  name: string,
): Promise<Readonly<{ body: Blob; contentType: string }> | null> => {
  const file = docImageFile(name);
  const full = file ? inDocs(file.path) : null;
  if (!file || full === null) return null;
  try {
    return { body: new Blob([await readFile(full)]), contentType: file.contentType };
  } catch (error) {
    if (isMissing(error)) return null;
    throw error;
  }
};
