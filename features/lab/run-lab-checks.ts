import "server-only";

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { setImmediate as nextTurn } from "node:timers/promises";

import {
  parseCommit,
  parseOpenTwinPin,
  parseOpenTwinShaFile,
} from "@/infrastructure/build-stamp";
import { bomText, buildBom, parseBunLock } from "@/infrastructure/cyclonedx";
import { database } from "@/infrastructure/database";
import {
  anatomyEnv,
  buildInfo,
  serverEnv,
  storageEnv,
  syntheaEnv,
} from "@/infrastructure/env";
import {
  EVAL_COHORT_ARCHIVE,
  SBOM_PATH,
  SYNTHEA_JAR_DEFAULT_PATH,
} from "@/infrastructure/local-artefacts";
import { isLoopbackUrl } from "@/infrastructure/loopback";
import { DEFAULT_OLLAMA_BASE_URL } from "@/infrastructure/ollama-context";
import { isInside } from "@/infrastructure/storage-hardening";
import { serverStorageFindings } from "@/infrastructure/storage-runtime";
import { resolveAnatomyDir } from "@/packages/anatomy/paths";

import { auditChainBase, auditChainCheck } from "./audit-chain-check";
import {
  AUDIT_WALK_START,
  type AuditWalk,
  type AuditWalkIo,
  type AuditWalkState,
  walkAuditChain,
} from "./audit-chain-walk";
import { createFileHasher } from "./file-hash";
import { type LabCheck, type LabSection, unavailableCheck } from "./lab-check";
import {
  localModelsBase,
  localModelsCheck,
  ollamaTagsUrl,
  parseOllamaModels,
} from "./local-models-check";
import { localOnlyBase, localOnlyCheck } from "./local-only-check";
import {
  type PinnedArtefact,
  pinnedArtefacts,
  pinnedArtefactsBase,
  pinnedArtefactsCheck,
} from "./pinned-artefacts-check";
import { provenanceBase, provenanceCheck } from "./provenance-check";
import { type CurrentSbom, sbomBase, sbomCheck } from "./sbom-check";
import { storageBase, storageCheck } from "./storage-check";

/**
 * The I/O half of the Lab page: reads the database, Ollama and files on this
 * machine, and hands what it found to the pure checks. Every check catches
 * its own failure, logs the reason here and shows a plain "could not run"
 * card with the same title and command as the working one, so one broken
 * source never hides the others.
 */

const OLLAMA_TIMEOUT_MS = 3000;
const GIT_TIMEOUT_MS = 3000;

type CheckBase = Pick<LabCheck, "id" | "title" | "howTo">;

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const guarded = async (
  base: CheckBase,
  run: () => Promise<LabCheck>,
): Promise<LabCheck> => {
  try {
    return await run();
  } catch (error) {
    console.error(`[lab] ${base.id} check failed`, errorName(error));
    return unavailableCheck(base);
  }
};

const readTextOrNull = (path: string): Promise<string | null> =>
  readFile(path, "utf8").catch(() => null);

// --- Local only ---------------------------------------------------------------

const checkLocalOnly = async (): Promise<LabCheck> => localOnlyCheck(serverEnv());

// --- Audit chain --------------------------------------------------------------

const auditIo = (): AuditWalkIo => {
  const client = database();
  return {
    count: () => client.auditEvent.count(),
    rowAt: (seq) => client.auditEvent.findUnique({ where: { seq } }),
    rowsAfter: (after, take) =>
      client.auditEvent.findMany({
        where: after === null ? undefined : { seq: { gt: after } },
        orderBy: { seq: "asc" },
        take,
      }),
    yieldNow: () => nextTurn(),
  };
};

/** Where the walk got to, kept for the next load; one walk at a time. */
const auditProgress: { state: AuditWalkState; running: Promise<AuditWalk> | null } = {
  state: AUDIT_WALK_START,
  running: null,
};

const walkAudit = (): Promise<AuditWalk> => {
  if (auditProgress.running !== null) return auditProgress.running;
  const run = walkAuditChain(auditIo(), auditProgress.state)
    .then((walk) => {
      auditProgress.state = walk.state;
      return walk;
    })
    .finally(() => {
      auditProgress.running = null;
    });
  auditProgress.running = run;
  return run;
};

const checkAuditChain = async (): Promise<LabCheck> =>
  auditChainCheck(
    await walkAudit().catch((error: unknown) => {
      console.error("[lab] audit table could not be read", errorName(error));
      return null;
    }),
  );

// --- Local models -------------------------------------------------------------

const fetchOllamaModels = async (tagsUrl: string | null) => {
  if (tagsUrl === null) return null;
  try {
    const response = await fetch(tagsUrl, {
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

const ollamaPlan = () => {
  const url = serverEnv().OLLAMA_BASE_URL ?? DEFAULT_OLLAMA_BASE_URL;
  return { url, tagsUrl: ollamaTagsUrl(url) };
};

const checkLocalModels = async (plan: ReturnType<typeof ollamaPlan>): Promise<LabCheck> =>
  localModelsCheck({
    onLoopback: isLoopbackUrl(plan.url),
    tagsUrl: plan.tagsUrl,
    models: await fetchOllamaModels(plan.tagsUrl),
  });

// --- Pinned artefacts ---------------------------------------------------------

const hashFile = createFileHasher();

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

type PinPlan = Readonly<{
  /** As shown and as written in the command. */
  pins: readonly PinnedArtefact[];
  /** Where each file is on this machine, by pin id. */
  files: ReadonlyMap<string, string>;
}>;

const pinPlan = (): PinPlan => {
  const cwd = process.cwd();
  const jar = resolve(
    /* turbopackIgnore: true */ cwd,
    syntheaEnv().jarPath ?? SYNTHEA_JAR_DEFAULT_PATH,
  );
  const anatomy = resolveAnatomyDir(anatomyEnv().dataDir, cwd);
  const absolute = pinnedArtefacts({
    syntheaJar: jar,
    syntheaDownloads: resolve(
      /* turbopackIgnore: true */ cwd,
      EVAL_COHORT_ARCHIVE.downloadDir,
    ),
    anatomy,
  });
  const jarShown = shownDir(cwd, jar, "SYNTHEA_JAR");
  return {
    pins: pinnedArtefacts({
      // SYNTHEA_JAR names the file itself, not a folder.
      syntheaJar: jarShown.startsWith("$") ? jarShown : relative(cwd, jar),
      syntheaDownloads: EVAL_COHORT_ARCHIVE.downloadDir,
      anatomy: shownDir(cwd, anatomy, "ANATOMY_DATA_DIR"),
    }),
    files: new Map(absolute.map((pin) => [pin.id, pin.path])),
  };
};

const checkPinnedArtefacts = async (plan: PinPlan): Promise<LabCheck> => {
  // hashFile never rejects: a file it cannot read is its own row.
  const found = await Promise.all(
    plan.pins.map(
      async (pin) => [pin.id, await hashFile(plan.files.get(pin.id) ?? "")] as const,
    ),
  );
  return pinnedArtefactsCheck(plan.pins, Object.fromEntries(found));
};

// --- Provenance ---------------------------------------------------------------

const gitHead = (cwd: string): Promise<string | null> =>
  new Promise((done) => {
    execFile(
      "git",
      ["rev-parse", "HEAD"],
      { cwd, timeout: GIT_TIMEOUT_MS, encoding: "utf8" },
      (error, stdout) => done(error ? null : parseCommit(stdout)),
    );
  });

const checkProvenance = async (): Promise<LabCheck> => {
  const cwd = process.cwd();
  const [provenance, shaFile, commit] = await Promise.all([
    readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, "PROVENANCE.md")),
    readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, ".open-twin/OPEN_TWIN_SHA")),
    gitHead(cwd),
  ]);
  return provenanceCheck({
    build: buildInfo(),
    disk: {
      commit,
      openTwinPinned: provenance === null ? null : parseOpenTwinPin(provenance),
      openTwinFound: shaFile === null ? null : parseOpenTwinShaFile(shaFile),
    },
  });
};

// --- SBOM ---------------------------------------------------------------------

const sha256OfText = (text: string): string =>
  createHash("sha256").update(text).digest("hex");

const parsePackageJson = (text: string): { name: string; version: string } | null => {
  try {
    const parsed = JSON.parse(text) as { name?: unknown; version?: unknown };
    return typeof parsed.name === "string" && typeof parsed.version === "string"
      ? { name: parsed.name, version: parsed.version }
      : null;
  } catch {
    return null;
  }
};

/** What `bun run sbom` would write from this checkout now. */
const currentSbom = async (cwd: string): Promise<CurrentSbom> => {
  const [lock, pkg] = await Promise.all([
    readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, "bun.lock")),
    readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, "package.json")),
  ]);
  const app = pkg === null ? null : parsePackageJson(pkg);
  if (app === null) return { kind: "unreadable", file: "package.json" };
  if (lock === null) return { kind: "unreadable", file: "bun.lock" };
  try {
    return { kind: "built", text: bomText(buildBom(parseBunLock(lock), app)) };
  } catch (error) {
    console.error("[lab] bun.lock could not be read", errorName(error));
    return { kind: "unreadable", file: "bun.lock" };
  }
};

const checkSbom = async (): Promise<LabCheck> => {
  const cwd = process.cwd();
  const text = await readTextOrNull(resolve(/* turbopackIgnore: true */ cwd, SBOM_PATH));
  if (text === null) return sbomCheck({ kind: "missing" });
  return sbomCheck({
    kind: "found",
    text,
    sha256: sha256OfText(text),
    current: await currentSbom(cwd),
  });
};

// --- Local storage ------------------------------------------------------------

/** The mesh folder as the card writes it: relative inside the repository, else its variable. */
const shownVitronic = (): string => {
  const cwd = process.cwd();
  const dir = storageEnv().vitronicDir;
  return isInside(cwd, dir) ? relative(cwd, dir) || "." : "$VITRONIC_DATA_DIR";
};

const checkStorage = async (vitronic: string): Promise<LabCheck> =>
  storageCheck({
    dataMode: storageEnv().dataMode,
    vitronic,
    findings: await serverStorageFindings({ logging: true }),
  });

// --- Section ------------------------------------------------------------------

const VERIFIABILITY_INTRO =
  "What runs on this machine, checked against what the repository says. Each check runs on the server when this page loads, and each card has a command that repeats it without the app. These are checks of this machine by this machine; they are not a remote attestation.";

export const loadVerifiability = async (): Promise<LabSection> => {
  const ollama = ollamaPlan();
  const pins = pinPlan();
  const vitronic = shownVitronic();
  return {
    id: "verifiability",
    title: "Verifiability",
    intro: VERIFIABILITY_INTRO,
    checks: await Promise.all([
      guarded(localOnlyBase, checkLocalOnly),
      guarded(storageBase(vitronic), () => checkStorage(vitronic)),
      guarded(auditChainBase, checkAuditChain),
      guarded(localModelsBase(ollama.tagsUrl), () => checkLocalModels(ollama)),
      guarded(pinnedArtefactsBase(pins.pins), () => checkPinnedArtefacts(pins)),
      guarded(provenanceBase, checkProvenance),
      guarded(sbomBase, checkSbom),
    ]),
  };
};
