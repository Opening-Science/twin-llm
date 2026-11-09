import "server-only";

import { readFile } from "node:fs/promises";
import { basename, join } from "node:path";

import {
  RESEARCH_SOURCES,
  type ResearchFiles,
  type ResearchRead,
  type ResearchSource,
  researchCards,
} from "./research-results";

/**
 * The I/O half of the research figures: reads the committed files under
 * `docs/research/` (fixed names, inside the repository, a few hundred kB in
 * all) and hands their text to `researchCards`. A file that cannot be read
 * is left out; its figure says so on the page and the reason goes to the
 * server log.
 */
export const loadResearch = async (): Promise<ResearchRead> => {
  const entries = await Promise.all(
    (Object.entries(RESEARCH_SOURCES) as [ResearchSource, string][]).map(
      async ([source, path]) => {
        // Scoped to docs/research so the build traces that folder, not the whole project.
        const file = join(process.cwd(), "docs", "research", basename(path));
        const text = await readFile(file, "utf8").catch((error: unknown) => {
          console.error(
            "[lab] research file could not be read",
            path,
            error instanceof Error ? error.name : typeof error,
          );
          return null;
        });
        return text === null ? [] : [[source, text] as const];
      },
    ),
  );
  const files: ResearchFiles = Object.fromEntries(entries.flat());
  return researchCards(files);
};
