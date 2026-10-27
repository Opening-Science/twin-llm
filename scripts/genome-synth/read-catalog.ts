/** Reads and checks the committed `variants.tsv`; throws with a plain message when it is broken. */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { parseCatalog, type Variant } from "./catalog";

export const CATALOG_PATH = fileURLToPath(new URL("./variants.tsv", import.meta.url));

export const readCatalog = async (path = CATALOG_PATH): Promise<readonly Variant[]> => {
  const parsed = parseCatalog(await readFile(path, "utf8"));
  if (typeof parsed === "string") throw new Error(parsed);
  return parsed;
};
