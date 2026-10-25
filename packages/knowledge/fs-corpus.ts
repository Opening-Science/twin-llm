import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { KNOWLEDGE_DIR } from "./constants";
import type { CorpusPorts } from "./corpus";

/** Reads knowledge/opentwin under `root` (the repo root by default). */
export const fileCorpusPorts = (root: string = process.cwd()): CorpusPorts => {
  const folder = join(root, KNOWLEDGE_DIR);
  return {
    listFiles: () => readdir(folder),
    readFile: (file) => readFile(join(folder, file), "utf8"),
  };
};
