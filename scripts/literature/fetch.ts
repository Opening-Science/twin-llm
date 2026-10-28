/**
 * Host CLI: fetch open-licence PMC articles for one agent specialty.
 *
 * Usage (from repo root):
 *   bun run literature:fetch -- --specialty diet --limit 50
 *   bun run literature:fetch -- --specialty sleep --limit 3 --dry-run
 *   bun run literature:fetch -- --specialty diet --allow cc0,cc-by   # training-safe only
 *   bun run literature:fetch -- --specialty gp --query '"hypertension"[mesh]'
 *   bun run literature:fetch -- --specialty diet --email you@example.org
 *
 * Searches PMC through NCBI E-utilities, reads each hit's licence from the
 * PMC Article Datasets metadata and stores only articles under an allowed
 * licence, as <pmcid>.<version>.txt plus a .json record, under
 * LITERATURE_DATA_DIR (default data/literature/<specialty>, gitignored).
 * Requests are sequential, at most one every 400 ms (NCBI asks for no more
 * than three a second without an API key). See docs/literature.md.
 */
import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  articleBaseName,
  type LiteratureRecord,
} from "../../packages/literature/article";
import { parseFetchArgs } from "../../packages/literature/args";
import {
  LITERATURE_DIR,
  MAX_ARTICLE_BYTES,
  MAX_METADATA_BYTES,
  REQUEST_INTERVAL_MS,
} from "../../packages/literature/constants";
import {
  fetchLiterature,
  type LiteratureFetchPorts,
} from "../../packages/literature/fetch";
import { createThrottle } from "../../packages/literature/throttle";
import { readBounded } from "../release/pinned-fetch";

const writeAtomic = async (path: string, text: string): Promise<void> => {
  const partial = `${path}.partial`;
  try {
    await writeFile(partial, text, "utf8");
    await rename(partial, path);
  } catch (error) {
    await rm(partial, { force: true });
    throw error;
  }
};

const livePorts = (dir: string): LiteratureFetchPorts => {
  const throttle = createThrottle(REQUEST_INTERVAL_MS, {
    now: () => Date.now(),
    sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  });
  const get = async (url: string, max: number): Promise<string> => {
    await throttle();
    const response = await fetch(url, { redirect: "error" });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`HTTP ${response.status}`);
    }
    return new TextDecoder().decode(await readBounded(response, max));
  };
  const folder = (specialty: string): string => join(dir, specialty);
  return {
    getText: (url) => get(url, MAX_METADATA_BYTES),
    getArticle: (url) => get(url, MAX_ARTICLE_BYTES),
    hasRecord: async (specialty, pmcid) => {
      const files = await readdir(folder(specialty)).catch(() => [] as string[]);
      return files.some((file) => file.startsWith(`${pmcid}.`) && file.endsWith(".json"));
    },
    writeArticle: async (record: LiteratureRecord, text: string) => {
      const target = folder(record.specialty);
      await mkdir(target, { recursive: true });
      const base = join(target, articleBaseName(record.pmcid, record.version));
      // Text first, so a record never points at a missing file.
      await writeAtomic(`${base}.txt`, text);
      await writeAtomic(`${base}.json`, `${JSON.stringify(record, null, 2)}\n`);
    },
    now: () => new Date(),
    log: (line) => console.log(line),
  };
};

const isMain = Boolean((import.meta as { main?: boolean }).main);

if (isMain) {
  const parsed = parseFetchArgs(process.argv.slice(2));
  if (!parsed.ok) {
    console.error(parsed.error);
    process.exit(2);
  }
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
  const dir = resolve(root, process.env.LITERATURE_DATA_DIR ?? LITERATURE_DIR);
  try {
    const result = await fetchLiterature(parsed.value, livePorts(dir));
    const verb = parsed.value.dryRun ? "would store" : "stored";
    console.log(
      `searched=${result.searched} ${verb}=${result.stored.length} skipped=${result.skipped.length}`,
    );
    if (!parsed.value.dryRun && result.stored.length > 0) {
      console.log(`Articles are in ${join(dir, parsed.value.specialty)}.`);
      console.log("Text from PubMed Central; credit the National Library of Medicine.");
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : "literature-fetch-failed");
    process.exit(1);
  }
}
