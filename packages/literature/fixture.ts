import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** Reads a test fixture from ./fixtures. Test-only. */
export const fixture = (name: string): string =>
  readFileSync(join(here, "fixtures", name), "utf8");
