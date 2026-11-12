import type { DocsFiles } from "./docs-pages";

/**
 * A per-process cache in front of the `docs/` folder. The shell layout is
 * dynamic, so /docs is rendered on every request; without this each request
 * lists the folder and reads every page, some over 1,000 lines.
 *
 * With `revalidate: false` (production) the list and each page are read once.
 * With `revalidate: true` (development) the folder is listed on every call and
 * a page is read again only when its modification time has changed.
 */

export type DocsDisk = Readonly<{
  /** Paths relative to `docs/`, posix separators. */
  listFiles: () => Promise<readonly string[]>;
  /** Modification time in milliseconds, or null when the file does not exist. */
  modifiedAt: (path: string) => Promise<number | null>;
  /** Text of a file relative to `docs/`, or null when it does not exist. */
  readText: (path: string) => Promise<string | null>;
}>;

type Entry = Readonly<{ modifiedAt: number | null; text: Promise<string | null> }>;

export const cachedDocsFiles = (
  disk: DocsDisk,
  { revalidate }: Readonly<{ revalidate: boolean }>,
): DocsFiles => {
  const texts = new Map<string, Entry>();
  const listing: { files: Promise<readonly string[]> | null } = { files: null };

  /** Stores the read before it settles, so concurrent requests share one read. */
  const load = (path: string, modifiedAt: number | null): Promise<string | null> => {
    const text = disk.readText(path);
    texts.set(path, { modifiedAt, text });
    text.catch(() => texts.delete(path));
    return text;
  };

  const listFiles = (): Promise<readonly string[]> => {
    if (revalidate) return disk.listFiles();
    if (listing.files === null) {
      const files = disk.listFiles();
      listing.files = files;
      files.catch(() => {
        listing.files = null;
      });
    }
    return listing.files;
  };

  const readText = async (path: string): Promise<string | null> => {
    const cached = texts.get(path);
    if (!revalidate) return cached ? cached.text : load(path, null);
    const modifiedAt = await disk.modifiedAt(path);
    if (modifiedAt === null) {
      texts.delete(path);
      return null;
    }
    return cached?.modifiedAt === modifiedAt ? cached.text : load(path, modifiedAt);
  };

  return { listFiles, readText };
};
