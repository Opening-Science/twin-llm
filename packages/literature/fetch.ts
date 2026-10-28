/**
 * The literature fetch with its I/O passed in, so tests run without network.
 * One article at a time: search PMC, then for each hit read its newest
 * metadata from the PMC bucket, check the licence and the retraction flag,
 * and only then read and store the text. Nothing is written in a dry run.
 */
import { type LiteratureRecord, toLiteratureRecord } from "./article";
import { MAX_FETCH_LIMIT } from "./constants";
import { decideLicence, type LiteratureLicence } from "./licence";
import {
  esearchUrl,
  latestMetadataKey,
  metadataListUrl,
  objectUrl,
  parseEsearchIds,
  parsePmcMetadata,
} from "./pmc";
import { type SpecialtyId, specialtySearchTerm } from "./specialties";

export type LiteratureFetchOptions = Readonly<{
  specialty: SpecialtyId;
  limit: number;
  query?: string;
  email?: string;
  allow: readonly LiteratureLicence[];
  dryRun: boolean;
}>;

export type LiteratureFetchPorts = Readonly<{
  /** GET a small text resource (search, listing, metadata); throws on non-2xx. */
  getText: (url: string) => Promise<string>;
  /** GET an article's plain text; throws on non-2xx or past the size cap. */
  getArticle: (url: string) => Promise<string>;
  hasRecord: (specialty: SpecialtyId, pmcid: string) => Promise<boolean>;
  writeArticle: (record: LiteratureRecord, text: string) => Promise<void>;
  now: () => Date;
  log: (line: string) => void;
}>;

export type SkipReason =
  | "already-stored"
  | "not-in-dataset"
  | "not-open-access"
  | "retracted"
  | "no-text"
  | "unknown-licence"
  | "not-allowed"
  | "failed";

export type LiteratureFetchResult = Readonly<{
  searched: number;
  stored: readonly Readonly<{ pmcid: string; licence: LiteratureLicence }>[];
  skipped: readonly Readonly<{ pmcid: string; reason: SkipReason; detail?: string }>[];
}>;

type Outcome =
  | Readonly<{ kind: "stored"; pmcid: string; licence: LiteratureLicence }>
  | Readonly<{ kind: "skipped"; pmcid: string; reason: SkipReason; detail?: string }>;

const fetchOne = async (
  pmcid: string,
  term: string,
  options: LiteratureFetchOptions,
  ports: LiteratureFetchPorts,
): Promise<Outcome> => {
  const skip = (reason: SkipReason, detail?: string): Outcome => ({
    kind: "skipped",
    pmcid,
    reason,
    ...(detail === undefined ? {} : { detail }),
  });
  if (await ports.hasRecord(options.specialty, pmcid)) return skip("already-stored");
  const key = latestMetadataKey(await ports.getText(metadataListUrl(pmcid)), pmcid);
  if (key === null) return skip("not-in-dataset");
  const meta = parsePmcMetadata(await ports.getText(objectUrl(key)));
  if (!meta.isOpenAccess) return skip("not-open-access");
  if (meta.isRetracted) return skip("retracted");
  const decision = decideLicence(meta.licenceCode, options.allow);
  if (!decision.ok) return skip(decision.reason, decision.code);
  if (meta.textUrl === null) return skip("no-text");
  if (!options.dryRun) {
    const text = await ports.getArticle(meta.textUrl);
    const record = toLiteratureRecord(meta, {
      specialty: options.specialty,
      licence: decision.licence,
      query: term,
      fetchedAt: ports.now().toISOString(),
    });
    await ports.writeArticle(record, text);
  }
  return { kind: "stored", pmcid, licence: decision.licence };
};

export const fetchLiterature = async (
  options: LiteratureFetchOptions,
  ports: LiteratureFetchPorts,
): Promise<LiteratureFetchResult> => {
  const term = specialtySearchTerm(options.specialty, options.query);
  // Some hits are skipped for their licence, so search for more than needed.
  const retmax = Math.min(options.limit * 3, MAX_FETCH_LIMIT * 3);
  const ids = parseEsearchIds(
    await ports.getText(
      esearchUrl({
        term,
        retmax,
        ...(options.email ? { email: options.email } : {}),
      }),
    ),
  );
  const outcomes: Outcome[] = [];
  for (const pmcid of ids) {
    if (outcomes.filter((outcome) => outcome.kind === "stored").length >= options.limit) {
      break;
    }
    const outcome = await fetchOne(pmcid, term, options, ports).catch(
      (error: unknown): Outcome => ({
        kind: "skipped",
        pmcid,
        reason: "failed",
        detail: error instanceof Error ? error.message : "unknown",
      }),
    );
    ports.log(
      outcome.kind === "stored"
        ? `${options.dryRun ? "would store" : "stored"} ${pmcid} ${outcome.licence}`
        : `skipped ${pmcid} ${outcome.reason}${outcome.detail ? ` (${outcome.detail})` : ""}`,
    );
    outcomes.push(outcome);
  }
  return {
    searched: ids.length,
    stored: outcomes.flatMap((outcome) =>
      outcome.kind === "stored"
        ? [{ pmcid: outcome.pmcid, licence: outcome.licence }]
        : [],
    ),
    skipped: outcomes.flatMap((outcome) =>
      outcome.kind === "skipped"
        ? [
            {
              pmcid: outcome.pmcid,
              reason: outcome.reason,
              ...(outcome.detail === undefined ? {} : { detail: outcome.detail }),
            },
          ]
        : [],
    ),
  };
};
