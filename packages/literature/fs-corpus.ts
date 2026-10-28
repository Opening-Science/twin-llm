import { readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { LITERATURE_DIR } from "./constants";
import type { LiteratureCorpusPorts } from "./corpus";

/** Reads data/literature/<specialty> under `dir` (repo default when omitted). */
export const fileLiteraturePorts = (
  dir: string = resolve(process.cwd(), LITERATURE_DIR),
): LiteratureCorpusPorts => ({
  listFiles: (specialty) => readdir(join(dir, specialty)).catch(() => []),
  readFile: (specialty, file) => readFile(join(dir, specialty, file), "utf8"),
});
