/**
 * The open annotated databases the benchmark reads, and which annotation
 * file gives each record's beats. Pure.
 *
 * - MIT-BIH Atrial Fibrillation Database (`--afdb`, #249): `.atr` holds rhythm
 *   annotations only; beats come from `.qrsc` (corrected) where a record has
 *   it, `.qrs` (unaudited detector output) otherwise.
 * - Long-Term AF Database (`--ltafdb`, #264): 84 records of about 24 h at
 *   128 Hz. `.atr` holds manually reviewed beat annotations labelled by type
 *   as well as the rhythm changes, so beats come from `.atr`; `.qrs` (detector
 *   output, every beat N) is the fallback for a record whose `.atr` has no
 *   beats.
 *
 * Reference rhythm is the `.atr` RHYTHM annotations in both.
 */
export type DatabaseId = "afdb" | "ltafdb";

/** The annotation file a record's beats were read from. */
export type BeatAnnotator = "qrs" | "qrsc" | "atr";

export type DatabaseSpec = Readonly<{
  id: DatabaseId;
  /** Name and version as `result.json` and the report give it. */
  name: string;
  /** Beat sources in order of preference; the first present with beats wins. */
  beatSources: readonly BeatAnnotator[];
  /** One sentence on where beats and rhythm come from, for the report. */
  annotationNote: string;
}>;

export const DATABASES: Readonly<Record<DatabaseId, DatabaseSpec>> = {
  afdb: {
    id: "afdb",
    name: "MIT-BIH Atrial Fibrillation Database 1.0.0 (PhysioNet)",
    beatSources: ["qrsc", "qrs"],
    annotationNote:
      "Reference rhythm from the .atr files; beats from .qrsc where the database has corrected beat annotations, .qrs otherwise.",
  },
  ltafdb: {
    id: "ltafdb",
    name: "Long-Term AF Database 1.0.0 (PhysioNet)",
    beatSources: ["atr", "qrs"],
    annotationNote:
      "Reference rhythm and beats from the .atr files (beats labelled by type and manually reviewed); .qrs only for a record whose .atr has no beats.",
  },
};

/**
 * The beats of the first source in `order` that has any, from the parsed beat
 * samples per source (a missing file is left out), or null when none has any.
 */
export const pickBeats = (
  order: readonly BeatAnnotator[],
  parsed: Readonly<Partial<Record<BeatAnnotator, readonly number[]>>>,
): Readonly<{ source: BeatAnnotator; beats: readonly number[] }> | null => {
  const source = order.find((each) => (parsed[each]?.length ?? 0) > 0);
  return source === undefined ? null : { source, beats: parsed[source] ?? [] };
};
