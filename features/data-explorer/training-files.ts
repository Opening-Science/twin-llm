import {
  type ConversationView,
  isSetName,
  type MetaIndex,
  parseConversation,
  parseManifest,
  parseMetaLines,
  setNamesFrom,
  type TrainingManifest,
} from "./training-sets";

/**
 * The Training tab's file reads, from `training-data/out/` (gitignored output
 * of `bun run training:conversations`). Only names from the directory listing
 * are ever opened, so a crafted URL cannot reach another path. One record is
 * read by streaming to its line, because a full training file is hundreds of
 * megabytes.
 *
 * The files hold synthetic rows the generator read from the warehouse, so like
 * the rest of the Data page they are shown in any DATA_MODE, to a signed-in
 * actor. A missing directory is "no sets yet", not
 * an error. I/O comes in as `TrainingFileDeps`; `training-file-ports.ts` holds
 * the real file system calls.
 */

export type TrainingFileDeps = Readonly<{
  /** The signed-in actor; with sign-in off, the local user. */
  resolveActorId: () => Promise<string | null>;
  /** File names in the output directory; [] when it does not exist. */
  listFiles: () => Promise<readonly string[]>;
  /** A file's text, or null when it does not exist. */
  readText: (fileName: string) => Promise<string | null>;
  /** One line (0-based, blank lines skipped), or null past the end. */
  readLine: (fileName: string, index: number) => Promise<string | null>;
}>;

export type TrainingSet = Readonly<{
  name: string;
  manifest: TrainingManifest | null;
}>;

type Blocked = Readonly<{ kind: "sign-in" }> | Readonly<{ kind: "failed" }>;

/** An actor, like the cohort tabs; null when there is one. */
const gate = async (deps: TrainingFileDeps): Promise<Blocked | null> =>
  (await deps.resolveActorId()) ? null : { kind: "sign-in" };

const failed = (where: string, error: unknown): Blocked => {
  console.error(
    `[data-explorer] ${where} failed`,
    error instanceof Error ? error.name : "unknown",
  );
  return { kind: "failed" };
};

export const loadTrainingSets = async (
  deps: TrainingFileDeps,
): Promise<Readonly<{ kind: "ok"; sets: readonly TrainingSet[] }> | Blocked> => {
  const blocked = await gate(deps);
  if (blocked) return blocked;
  try {
    const names = setNamesFrom(await deps.listFiles());
    const sets = await Promise.all(
      names.map(async (name) => ({
        name,
        manifest: parseManifest(await deps.readText(`${name}.manifest.json`)),
      })),
    );
    return { kind: "ok", sets };
  } catch (error) {
    return failed("training list", error);
  }
};

export type TrainingSetDetail = TrainingSet & Readonly<{ meta: MetaIndex | null }>;

const knownSet = async (deps: TrainingFileDeps, name: string): Promise<boolean> =>
  isSetName(name) && setNamesFrom(await deps.listFiles()).includes(name);

export const loadTrainingSet = async (
  deps: TrainingFileDeps,
  name: string,
): Promise<
  | Readonly<{ kind: "ok"; set: TrainingSetDetail }>
  | Readonly<{ kind: "not-found" }>
  | Blocked
> => {
  const blocked = await gate(deps);
  if (blocked) return blocked;
  try {
    if (!(await knownSet(deps, name))) return { kind: "not-found" };
    const [manifestText, metaText] = await Promise.all([
      deps.readText(`${name}.manifest.json`),
      deps.readText(`${name}.meta.jsonl`),
    ]);
    return {
      kind: "ok",
      set: {
        name,
        manifest: parseManifest(manifestText),
        meta: metaText === null ? null : parseMetaLines(metaText),
      },
    };
  } catch (error) {
    return failed("training set", error);
  }
};

export const loadConversation = async (
  deps: TrainingFileDeps,
  name: string,
  index: number,
): Promise<
  | Readonly<{ kind: "ok"; conversation: ConversationView }>
  | Readonly<{ kind: "not-found" }>
  | Blocked
> => {
  const blocked = await gate(deps);
  if (blocked) return blocked;
  if (!Number.isInteger(index) || index < 0) return { kind: "not-found" };
  try {
    if (!(await knownSet(deps, name))) return { kind: "not-found" };
    const line = await deps.readLine(`${name}.jsonl`, index);
    const conversation = line === null ? null : parseConversation(line);
    return conversation ? { kind: "ok", conversation } : { kind: "not-found" };
  } catch (error) {
    return failed("training conversation", error);
  }
};
