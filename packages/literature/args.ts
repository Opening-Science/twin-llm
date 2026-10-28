import { DEFAULT_FETCH_LIMIT, MAX_FETCH_LIMIT } from "./constants";
import {
  isLiteratureLicence,
  LITERATURE_LICENCES,
  type LiteratureLicence,
} from "./licence";
import { isSpecialtyId, SPECIALTY_IDS, type SpecialtyId } from "./specialties";

export type FetchArgs = Readonly<{
  specialty: SpecialtyId;
  limit: number;
  query?: string;
  email?: string;
  allow: readonly LiteratureLicence[];
  dryRun: boolean;
}>;

export type IngestArgs = Readonly<{ specialty?: SpecialtyId }>;

export type Parsed<T> =
  Readonly<{ ok: true; value: T }> | Readonly<{ ok: false; error: string }>;

/** `--name value` and `--name=value` pairs, plus bare `--flag`s. */
const readFlags = (
  argv: readonly string[],
): { flags: Map<string, string>; error: string | null } => {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--") continue;
    if (!arg.startsWith("--")) return { flags, error: `unexpected argument ${arg}` };
    const eq = arg.indexOf("=");
    if (eq > 0) {
      flags.set(arg.slice(2, eq), arg.slice(eq + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next !== undefined && !next.startsWith("--")) {
      flags.set(arg.slice(2), next);
      index += 1;
    } else {
      flags.set(arg.slice(2), "");
    }
  }
  return { flags, error: null };
};

const FETCH_FLAGS = ["specialty", "limit", "query", "email", "allow", "dry-run"];

const specialtyError = `--specialty must be one of ${SPECIALTY_IDS.join(", ")}`;

export const parseFetchArgs = (argv: readonly string[]): Parsed<FetchArgs> => {
  const { flags, error } = readFlags(argv);
  if (error) return { ok: false, error };
  const unknown = [...flags.keys()].find((key) => !FETCH_FLAGS.includes(key));
  if (unknown) return { ok: false, error: `unknown option --${unknown}` };
  const specialty = flags.get("specialty") ?? "";
  if (!isSpecialtyId(specialty)) return { ok: false, error: specialtyError };
  const limitText = flags.get("limit");
  const limit = limitText === undefined ? DEFAULT_FETCH_LIMIT : Number(limitText);
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_FETCH_LIMIT) {
    return {
      ok: false,
      error: `--limit must be a whole number from 1 to ${MAX_FETCH_LIMIT}`,
    };
  }
  const allowText = flags.get("allow");
  const allow =
    allowText === undefined
      ? LITERATURE_LICENCES
      : allowText.split(",").map((item) => item.trim().toLowerCase());
  const badLicence = allow.find((item) => !isLiteratureLicence(item));
  if (badLicence !== undefined || allow.length === 0) {
    return {
      ok: false,
      error: `--allow takes a comma list of ${LITERATURE_LICENCES.join(", ")}`,
    };
  }
  const query = flags.get("query");
  const email = flags.get("email");
  if (email !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "--email must be an email address" };
  }
  return {
    ok: true,
    value: {
      specialty,
      limit,
      allow: allow.filter(isLiteratureLicence),
      dryRun: flags.has("dry-run"),
      ...(query ? { query } : {}),
      ...(email ? { email } : {}),
    },
  };
};

export const parseIngestArgs = (argv: readonly string[]): Parsed<IngestArgs> => {
  const { flags, error } = readFlags(argv);
  if (error) return { ok: false, error };
  const unknown = [...flags.keys()].find((key) => key !== "specialty");
  if (unknown) return { ok: false, error: `unknown option --${unknown}` };
  const specialty = flags.get("specialty");
  if (specialty === undefined) return { ok: true, value: {} };
  if (!isSpecialtyId(specialty)) return { ok: false, error: specialtyError };
  return { ok: true, value: { specialty } };
};
