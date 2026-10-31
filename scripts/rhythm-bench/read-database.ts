/**
 * Reads an annotated database (MIT-BIH AFDB or the Long-Term AF Database)
 * from a directory, never copying it into the repository. I/O only; the
 * parsing is in wfdb-header.ts and mit-annotations.ts. Used by the benchmark
 * (#249) and the resolution study (#290).
 */
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { type AfdbRecordInput } from "./benchmark";
import {
  type BeatAnnotator,
  DATABASES,
  type DatabaseId,
  type DatabaseSpec,
  pickBeats,
} from "./databases";
import { beatSamples, parseMitAnnotations, rhythmChanges } from "./mit-annotations";
import { parseWfdbHeader } from "./wfdb-header";

const annotationsIn = async (path: string) =>
  existsSync(path) ? parseMitAnnotations(new Uint8Array(await readFile(path))) : null;

/**
 * One record: header, reference rhythm and beats from the database's beat
 * source. Only beat samples and rhythm changes are kept; the signal files are
 * never opened, so a 24 h record costs its annotation files, not its signal.
 */
const readRecord = async (
  spec: DatabaseSpec,
  dir: string,
  record: string,
): Promise<AfdbRecordInput> => {
  const header = parseWfdbHeader(await readFile(join(dir, `${record}.hea`), "utf8"));
  const reference = await annotationsIn(join(dir, `${record}.atr`));
  if (reference === null) throw new Error(`${record}.atr is missing in ${dir}`);
  const parsed: Partial<Record<BeatAnnotator, number[]>> = {};
  for (const source of spec.beatSources) {
    const annotations =
      source === "atr"
        ? reference
        : await annotationsIn(join(dir, `${record}.${source}`));
    if (annotations !== null) parsed[source] = beatSamples(annotations);
  }
  const picked = pickBeats(spec.beatSources, parsed);
  if (picked === null) throw new Error(`no beat annotations for ${record} in ${dir}`);
  return {
    record,
    beatAnnotator: picked.source,
    samplingHz: header.samplingHz,
    hasSignalFile: existsSync(join(dir, `${record}.dat`)),
    beats: picked.beats,
    rhythmChanges: rhythmChanges(reference),
  };
};

/** Every record in RECORDS, read one after another to keep memory to one record's files. */
export const readDatabase = async (id: DatabaseId, dir: string) => {
  const spec = DATABASES[id];
  const names = (await readFile(join(dir, "RECORDS"), "utf8"))
    .split(/\s+/)
    .filter((name) => name.length > 0);
  const records: AfdbRecordInput[] = [];
  for (const name of names) records.push(await readRecord(spec, dir, name));
  const sums = join(dir, "SHA256SUMS.txt");
  return {
    database: id,
    records,
    sha256SumsFile: existsSync(sums)
      ? createHash("sha256")
          .update(await readFile(sums))
          .digest("hex")
      : null,
  };
};
