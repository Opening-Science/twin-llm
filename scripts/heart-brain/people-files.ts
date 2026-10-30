/** Where `bun run heart-brain` keeps one batch's people facts, and how to read them back. */
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type PersonFacts } from "./person-facts";

export const peopleFile = (out: string, batch: string): string =>
  join(out, "people", `batch-${batch}.jsonl`);

export const metaFile = (out: string, batch: string): string =>
  join(out, "people", `batch-${batch}.meta.json`);

/** One JSON object per non-empty line. */
export const parsePeopleLines = (text: string): PersonFacts[] =>
  text
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as PersonFacts);

export const readPeople = async (
  out: string,
  batch: string,
): Promise<readonly PersonFacts[]> =>
  parsePeopleLines(await readFile(peopleFile(out, batch), "utf8"));
