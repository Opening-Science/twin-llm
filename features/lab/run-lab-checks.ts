import "server-only";

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { bomText, buildBom, parseBunLock } from "@/infrastructure/cyclonedx";
import { database } from "@/infrastructure/database";
import {
  anatomyEnv,
  buildInfo,
  DEFAULT_OLLAMA_BASE_URL,
  serverEnv,
  syntheaEnv,
} from "@/infrastructure/env";
import {
  EVAL_COHORT_ARCHIVE,
  SBOM_PATH,
  SYNTHEA_JAR_DEFAULT_PATH,
} from "@/infrastructure/local-artefacts";
import { isLoopbackUrl } from "@/infrastructure/loopback";
import { resolveAnatomyDir } from "@/packages/anatomy/paths";
import { type VerifyChainResult, verifyChain } from "@/packages/audit/verify-chain";

import {
  AUDIT_PAGE_ROW_LIMIT,
  auditChainCheck,
  type TooManyRows,
} from "./audit-chain-check";
import { type LabCheck, type LabSection, unavailableCheck } from "./lab-check";
import { localModelsCheck, parseOllamaModels } from "./local-models-check";
import { localOnlyCheck } from "./local-only-check";
import { pinnedArtefacts, pinnedArtefactsCheck } from "./pinned-artefacts-check";
import {
  parseOpenTwinPin,
  parseOpenTwinShaFile,
  provenanceCheck,
} from "./provenance-check";
import { countSbomComponents, sbomCheck } from "./sbom-check";

/**
 * The I/O half of the Lab page: reads the database, Ollama and files on this
 * machine, and hands what it found to the pure checks. Every check catches
 * its own failure, logs the reason here and shows a plain "could not run"
 * card, so one broken source never hides the others.
 */

const OLLAMA_TIMEOUT_MS = 3000;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const guarded = async (
  base: Pick<LabCheck, "id" | "title" | "howTo">,
  run: () => Promise<LabCheck>,
): Promise<LabCheck> => {
  try {
    return await run();
  } catch (error) {
    console.error(`[lab] ${base.id} check failed`, errorName(error));
    return unavailableCheck(base);
  }
};

// --- Files ------------------------------------------------------------------

const hashCache = new Map<string, string>();

const sha256OfStream = (path: string): Promise<string> =>
  new Promise((done, fail) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", fail)
      .on("end", () => done(hash.digest("hex")));
  });

/**
 * SHA-256 of a file, or null when there is none. Kept per path, size and
 * modification time, so a reload does not re-read a 200 MB JAR but a
 * replaced file is hashed again.
 */
const sha256OfFile = async (path: string): Promise<string | null> => {
  const found = await stat(path).catch(() => null);
  if (found === null || !found.isFile()) return null;
  const key = `${path}\0${found.size}\0${found.mtimeMs}`;
  const cached = hashCache.get(key);
  if (cached !== undefined) return cached;
  const sha = await sha256OfStream(path);
  hashCache.set(key, sha);
  return sha;
};

const readTextOrNull = (path: string): Promise<string | null> =>
  readFile(path, "utf8").catch(() => null);

// --- Checks -----------------------------------------------------------------

const checkLocalOnly = async (): Promise<LabCheck> => localOnlyCheck(serverEnv());

const readAuditChain = async (): Promise<VerifyChainResult | TooManyRows> => {
  const client = database();
  const total = await client.auditEvent.count();
  return total > AUDIT_PAGE_ROW_LIMIT ? { kind: "too-many", total } : verifyChain(client);
};

const checkAuditChain = async (): Promise<LabCheck> =>
  auditChainCheck(
    await readAuditChain().catch((error: unknown) => {
      console.error("[lab] audit table could not be read", errorName(error));
      return null;
    }),
  );

const fetchOllamaModels = async (root: string) => {
  try {
    const response = await fetch(`${root}/api/tags`, {
      cache: "no-store",
      signal: AbortSignal.timeout(OLLAMA_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error("[lab] Ollama tags answered", response.status);
      return null;
    }
    return parseOllamaModels(await response.json());
  } catch (error) {
    console.error("[lab] Ollama unreachable", errorName(error));
    return null;
  }
};

const checkLocalModels = async (): Promise<LabCheck> => {
  const url = serverEnv().OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  const root = url.replace(/\/v1\/?$/, "");
  return localModelsCheck({
    onLoopback: isLoopbackUrl(url),
    models: await fetchOllamaModels(root),
  });
};

/**
 * How a folder is written on the page: relative to the repository root when
 * it is inside it, else as the variable that set it, so a home path is never
 * shown.
 */
const shownDir = (cwd: string, path: string, variable: string): string => {
  const inside = relative(cwd, path);
  if (inside === "") return ".";
  return !inside.startsWith("..") && !isAbsolute(inside) ? inside : `$${variable}`;
};

const checkPinnedArtefacts = async (): Promise<LabCheck> => {
  const cwd = process.cwd();
  const jar = resolve(
    /* turbopackIgnore: true */ cwd,
    syntheaEnv().jarPath ?? SYNTHEA_JAR_DEFAULT_PATH,
  );
  const absolute = {
    syntheaJar: jar,
    syntheaDownloads: resolve(
      /* turbopackIgnore: true */ cwd,
      EVAL_COHORT_ARCHIVE.downloadDir,
    ),
    anatomy: resolveAnatomyDir(anatomyEnv().dataDir, cwd),
  };
  const files = new Map(pinnedArtefacts(absolute).map((pin) => [pin.id, pin.path]));
  const jarDir = shownDir(cwd, jar, "SYNTHEA_JAR");
  const pins = pinnedArtefacts({
    // SYNTHEA_JAR names the file itself, not a folder.
    syntheaJar: jarDir === "$SYNTHEA_JAR" ? jarDir : relative(cwd, jar),
    syntheaDownloads: EVAL_COHORT_ARCHIVE.downloadDir,
    anatomy: shownDir(cwd, absolute.anatomy, "ANATOMY_DATA_DIR"),
  });
  const found = await Promise.all(
    pins.map(
      async (pin) => [pin.id, await sha256OfFile(files.get(pin.id) ?? "")] as const,
    ),
  );
  return pinnedArtefactsCheck(pins, Object.fromEntries(found));
};

const checkProvenance = async (): Promise<LabCheck> => {
  const cwd = process.cwd();
  const [provenance, shaFile] = await Promise.all([
    readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, "PROVENANCE.md")),
    readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, ".open-twin/OPEN_TWIN_SHA")),
  ]);
  return provenanceCheck({
    ...buildInfo(),
    openTwinPinned: provenance === null ? null : parseOpenTwinPin(provenance),
    openTwinFound: shaFile === null ? null : parseOpenTwinShaFile(shaFile),
  });
};

const sha256OfText = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

/** What `bun run sbom` would write from this checkout now, or null. */
const currentSbomSha = async (cwd: string): Promise<string | null> => {
  const [lock, pkg] = await Promise.all([
    readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, "bun.lock")),
    readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, "package.json")),
  ]);
  if (lock === null || pkg === null) return null;
  const app = JSON.parse(pkg) as { name: string; version: string };
  return sha256OfText(bomText(buildBom(parseBunLock(lock), app)));
};

const checkSbom = async (): Promise<LabCheck> => {
  const cwd = process.cwd();
  const text = await readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, SBOM_PATH));
  if (text === null) return sbomCheck({ kind: "missing" });
  return sbomCheck({
    kind: "found",
    sha256: sha256OfText(text),
    components: countSbomComponents(text),
    currentSha256: await currentSbomSha(cwd).catch((error: unknown) => {
      console.error("[lab] bun.lock could not be read", errorName(error));
      return null;
    }),
  });
};

const VERIFIABILITY_INTRO =
  "What runs on this machine, checked against what the repository says. Each check runs on the server when this page loads, and each card has a command that repeats it without the app. These are checks of this machine by this machine; they are not a remote attestation.";

export const loadVerifiability = async (): Promise<LabSection> => ({
  id: "verifiability",
  title: "Verifiability",
  intro: VERIFIABILITY_INTRO,
  checks: await Promise.all([
    guarded(
      { id: "local-only", title: "Local only", howTo: "bun run doctor" },
      checkLocalOnly,
    ),
    guarded(
      {
        id: "audit-chain",
        title: "Audit chain",
        howTo: "bun --env-file=.env.local packages/audit/verify-cli.ts --check",
      },
      checkAuditChain,
    ),
    guarded(
      { id: "local-models", title: "Local models", howTo: "ollama list" },
      checkLocalModels,
    ),
    guarded(
      { id: "pinned-artefacts", title: "Pinned artefacts", howTo: "sha256sum <file>" },
      checkPinnedArtefacts,
    ),
    guarded(
      { id: "provenance", title: "Provenance", howTo: "git rev-parse HEAD" },
      checkProvenance,
    ),
    guarded(
      { id: "sbom", title: "Software bill of materials", howTo: "bun run sbom" },
      checkSbom,
    ),
  ]),
});
