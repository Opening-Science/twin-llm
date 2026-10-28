import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createThreadExportHandler } from "@/features/arena/thread-export-handler";
import { getGenomeReportResponse } from "@/features/digital-twin/genome-run";
import { loadYourData, postReviewResponse } from "@/features/personal-data/import-routes";
import { createSearchHandlers } from "@/features/search/search-handler";
import { createVitronicAvatarHandler } from "@/features/vitronic/avatar-handler";
import {
  getLatestVitronicSummary,
  getVitronicConnectionStatus,
  listSnapshotsForSubject,
  listVitronicSubjects,
  loadAvatarForSnapshot,
  type VitronicLocalReadPorts,
} from "@/features/vitronic/connection";
import { createVitronicSnapshotsHandler } from "@/features/vitronic/snapshots-handler";
import { createVitronicStatusGetHandler } from "@/features/vitronic/status-handler";
import { createVitronicSubjectsGetHandler } from "@/features/vitronic/subjects-handler";
import { createWearablesSummaryHandler } from "@/features/wearables/summary-handler";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import type { PersonalDataStore } from "@/infrastructure/personal-data-store";
import type { AppendInput } from "@/packages/audit/append";

/**
 * Every app/api route that reads personal data, and what it writes to the
 * audit chain (#143). Each `audited` entry calls the route's handler with
 * fakes (synthetic values only) and expects exactly the rows named, which is
 * one row per read for all of them but the wearables summary: that one reads
 * four sources and writes one row for Oura, Whoop and Google Health and one
 * in the BodyLoop reader.
 *
 * This list is kept by hand. A new route must be added here, as `audited`,
 * `elsewhere`, `exempt` (no personal data, or a write audited in its own
 * handler) or `open` (a known gap): the last test walks app/api and fails on
 * any route this list does not name.
 */

const ACTOR = "user_synthetic_1";
const APP_USER = "app-user-synthetic-1";
const SUBJECT_ID = "subj-synthetic-1";

type Recorder = Readonly<{
  rows: AppendInput[];
  append: (input: AppendInput) => Promise<{
    seq: bigint;
    hash: string;
    argsSha256: string;
    resultSha256: string;
  }>;
}>;

const recorder = (): Recorder => {
  const rows: AppendInput[] = [];
  return {
    rows,
    append: async (input) => {
      rows.push(input);
      return {
        seq: 1n,
        hash: "h",
        argsSha256: "a".repeat(64),
        resultSha256: "b".repeat(64),
      };
    },
  };
};

const SUMMARY = {
  window: { startDate: "2026-01-01", endDate: "2026-01-04" },
  metrics: [],
  narrative: "Synthetic wearable context for 2026-01-01 to 2026-01-04.",
};

const snapshotRow = {
  id: "snap-synthetic-1",
  viatarId: 4,
  glbSha256: null,
  syncedAt: new Date("2026-01-01T00:00:00.000Z"),
  summary: { ...SUMMARY, metrics: [] },
  markers: [],
  measures: [],
  presetName: "Default",
  subjectId: SUBJECT_ID,
};

/** The BodyLoop readers' own ports: a fake database and the recorder's append. */
const vitronicPorts = (record: Recorder): VitronicLocalReadPorts => ({
  append: record.append,
  database: () => ({
    vitronicSubject: {
      findMany: async () => [
        {
          id: SUBJECT_ID,
          label: "Self",
          source: "scanner",
          isSelf: true,
          probandId: 7,
          defaultViatarId: null,
        },
      ],
    },
    vitronicConnection: {
      findUnique: async () => ({ lastSyncAt: null, tlsFingerprintSha256: null }),
    },
    vitronicSnapshot: {
      findMany: async () => [snapshotRow],
      findFirst: async () => snapshotRow,
    },
  }),
});

const signedIn = {
  resolveActorId: async () => ACTOR,
  findAppUserId: async () => APP_USER,
};

const vitronicConfigured = () => ({ encryptionKey: "synthetic", dataDir: null });

const params = <T>(value: T) => ({ params: Promise.resolve(value) });

const emptyStore: PersonalDataStore = {
  list: async () => [],
  findBySha: async () => null,
  save: async () => {
    throw new Error("not used");
  },
  rename: async () => null,
  remove: async () => null,
};

type Audited = Readonly<{
  kind: "audited";
  /** The audit rows one call writes, in order. */
  tools: readonly string[];
  call: (record: Recorder) => Promise<unknown>;
}>;

type Entry =
  | Audited
  /** Audited by code this test cannot call with fakes; `why` says where. */
  | Readonly<{ kind: "elsewhere"; why: string }>
  /** Reads no personal data, or only writes (each write is audited where it happens). */
  | Readonly<{ kind: "exempt"; why: string }>
  /** Reads personal data without a row of its own yet: a known gap, not a pass. */
  | Readonly<{ kind: "open"; why: string }>;

const WRITE = "a write; its handler or reader audits it, nothing personal is read back";
const NOT_PERSONAL = "shipped assets or settings, no personal data";
const OAUTH = "OAuth or disconnect; no health data is read";
const CONNECTION_ONLY =
  "connection row only (linked at, last sync), never a snapshot; nothing to audit";

/** Route path and method → what it writes to the audit chain. */
const PERSONAL_READ_ROUTES: Readonly<Record<string, Entry>> = {
  "GET /api/wearables/summary": {
    kind: "audited",
    tools: ["vitronic.wearables.summary", "personal.read.wearables-summary"],
    call: (record) =>
      createWearablesSummaryHandler({
        ...signedIn,
        getLatestOuraSummary: async () => SUMMARY,
        getLatestWhoopSummary: async () => null,
        getLatestGoogleHealthSummary: async () => SUMMARY,
        getLatestVitronicSummary: (userId, opts) =>
          getLatestVitronicSummary(userId, { ...opts, ports: vitronicPorts(record) }),
        auditPersonalRead: auditPersonalRead(record.append),
      })(),
  },
  "GET /api/genome/report": {
    kind: "audited",
    tools: ["personal.read.genome-report"],
    call: (record) =>
      getGenomeReportResponse({
        resolveActorId: signedIn.resolveActorId,
        permit: () => ({ ok: true }),
        assumeBuild: () => null,
        latest: async () => null,
        audit: record.append,
        sessionId: () => "session-1",
      }),
  },
  "GET /api/vitronic/status": {
    kind: "audited",
    tools: ["vitronic.connection.status"],
    call: (record) =>
      createVitronicStatusGetHandler({
        ...signedIn,
        vitronicEnv: vitronicConfigured,
        getVitronicConnectionStatus: (userId) =>
          getVitronicConnectionStatus(userId, { ports: vitronicPorts(record) }),
      })(),
  },
  "GET /api/vitronic/subjects": {
    kind: "audited",
    tools: ["vitronic.subjects.list"],
    call: (record) =>
      createVitronicSubjectsGetHandler({
        ...signedIn,
        vitronicEnv: vitronicConfigured,
        listVitronicSubjects: (userId) =>
          listVitronicSubjects(userId, { ports: vitronicPorts(record) }),
        createVitronicSubject: async () => {
          throw new Error("not used");
        },
      })(),
  },
  "GET /api/vitronic/subjects/[subjectId]/snapshots": {
    kind: "audited",
    tools: ["vitronic.snapshots.list"],
    call: (record) =>
      createVitronicSnapshotsHandler({
        ...signedIn,
        vitronicEnv: vitronicConfigured,
        listSnapshotsForSubject: (userId, subjectId, opts) =>
          listSnapshotsForSubject(userId, subjectId, {
            ...opts,
            ports: vitronicPorts(record),
          }),
      })(new Request("http://localhost/"), params({ subjectId: SUBJECT_ID })),
  },
  "GET /api/vitronic/subjects/[subjectId]/scans": {
    kind: "elsewhere",
    why: "listScansForSubject writes vitronic.scans; it asks the scanner too, so it takes no fakes (checked in its source below)",
  },
  "GET /api/vitronic/avatar/[snapshotId]": {
    kind: "audited",
    tools: ["vitronic.avatar"],
    call: (record) =>
      createVitronicAvatarHandler({
        ...signedIn,
        loadAvatarForSnapshot: (userId, snapshotId, actor) =>
          loadAvatarForSnapshot(userId, snapshotId, actor, {
            ports: vitronicPorts(record),
          }),
      })(new Request("http://localhost/"), params({ snapshotId: "snap-synthetic-1" })),
  },
  "GET /api/ark/status": {
    kind: "elsewhere",
    why: "packages/ark-adapter writes one row per Ark call (status, data list, data paths); its own tests cover that",
  },
  "GET /api/ark/audit": {
    kind: "exempt",
    why: "lists the person's own ark.* and genome.* audit rows: tool, time, hash prefix; no health data",
  },
  "POST /api/genome/run": { kind: "exempt", why: WRITE },
  "POST /api/personal-data/review": {
    kind: "audited",
    tools: ["personal-data.review"],
    call: (record) =>
      postReviewResponse(
        new Request("http://localhost/api/personal-data/review", {
          method: "POST",
          body: new FormData(),
        }),
        {
          resolveActorId: signedIn.resolveActorId,
          permit: () => true,
          findUserId: signedIn.findAppUserId,
          store: emptyStore,
          audit: record.append,
          sessionId: () => "session-1",
        },
      ),
  },
  "POST /api/personal-data/datasets": { kind: "exempt", why: WRITE },
  "PATCH /api/personal-data/datasets/[id]": { kind: "exempt", why: WRITE },
  "DELETE /api/personal-data/datasets/[id]": { kind: "exempt", why: WRITE },
  "GET /api/search": {
    kind: "audited",
    tools: ["search.threads"],
    call: (record) =>
      createSearchHandlers({
        resolveActorId: signedIn.resolveActorId,
        findAppUserId: signedIn.findAppUserId,
        searchThreads: async () => ({ items: [], semantic: false }),
        indexPending: async () => ({ indexed: 0, pending: 0, embedding: true }),
        docs: { listPages: async () => [], readText: async () => null },
        audit: record.append,
        logError: () => undefined,
      }).GET(new Request("http://localhost/api/search?q=sleep&tab=threads")),
  },
  "POST /api/search": {
    kind: "exempt",
    why: "embeds new thread text for search on this machine; nothing goes back out",
  },
  "GET /api/threads/[threadId]/export": {
    kind: "audited",
    tools: ["thread.export"],
    call: (record) =>
      createThreadExportHandler({
        loadOwnedThread: async () => ({ title: "Synthetic thread", turns: [] }),
        actorId: signedIn.resolveActorId,
        recipientIsLocal: () => true,
        appendAudit: record.append,
        today: () => "2026-10-28",
      })("thread-synthetic-1"),
  },
  "POST /api/chat": {
    kind: "open",
    why: "tool reads are audited per call, and BodyLoop context writes vitronic.chat.summary, but the Oura, Whoop and Google Health summaries put in the prompt in personal mode write no row yet",
  },
  "POST /api/chat/incognito": {
    kind: "open",
    why: "the same wearable context as /api/chat, through the same start",
  },
  "GET /api/chat/suggestions": {
    kind: "elsewhere",
    why: "the coverage and wearable_coverage tools it runs write their rows, like any chat tool call",
  },
  "POST /api/onboarding/starters": {
    kind: "exempt",
    why: "linked source names only; a send to a hosted model is audited as provider.personal_data_sent",
  },
  "GET /api/biomarkers/cohort": {
    kind: "exempt",
    why: "synthetic Demo cohort only (its handler still writes biomarkers.cohort.list)",
  },
  "GET /api/biomarkers/cohort/[subjectRef]": {
    kind: "exempt",
    why: "synthetic Demo cohort only (its handler still writes biomarkers.cohort.values)",
  },
  "GET /api/oura/status": { kind: "exempt", why: CONNECTION_ONLY },
  "GET /api/whoop/status": { kind: "exempt", why: CONNECTION_ONLY },
  "GET /api/google-health/status": { kind: "exempt", why: CONNECTION_ONLY },
  "GET /api/oura/authorize": { kind: "exempt", why: OAUTH },
  "GET /api/oura/callback": { kind: "exempt", why: OAUTH },
  "DELETE /api/oura/disconnect": { kind: "exempt", why: OAUTH },
  "POST /api/oura/sync": { kind: "exempt", why: WRITE },
  "GET /api/whoop/authorize": { kind: "exempt", why: OAUTH },
  "GET /api/whoop/callback": { kind: "exempt", why: OAUTH },
  "DELETE /api/whoop/disconnect": { kind: "exempt", why: OAUTH },
  "POST /api/whoop/sync": { kind: "exempt", why: WRITE },
  "GET /api/google-health/authorize": { kind: "exempt", why: OAUTH },
  "GET /api/google-health/callback": { kind: "exempt", why: OAUTH },
  "DELETE /api/google-health/disconnect": { kind: "exempt", why: OAUTH },
  "POST /api/google-health/sync": { kind: "exempt", why: WRITE },
  "POST /api/vitronic/connect": { kind: "exempt", why: WRITE },
  "POST /api/vitronic/sync": { kind: "exempt", why: WRITE },
  "POST /api/vitronic/subjects": { kind: "exempt", why: WRITE },
  "PUT /api/vitronic/subjects/[subjectId]/default": { kind: "exempt", why: WRITE },
  "POST /api/vitronic/subjects/[subjectId]/files": { kind: "exempt", why: WRITE },
  "POST /api/vitronic/subjects/[subjectId]/sync": { kind: "exempt", why: WRITE },
  "POST /api/vitronic/upload/[connectionId]": { kind: "exempt", why: WRITE },
  "GET /api/anatomy/status": { kind: "exempt", why: NOT_PERSONAL },
  "GET /api/anatomy/atlas/[atlasId]": { kind: "exempt", why: NOT_PERSONAL },
  "GET /api/anatomy/demo/[bodyId]": { kind: "exempt", why: NOT_PERSONAL },
  "GET /api/anatomy/rigged/[bodyId]": { kind: "exempt", why: NOT_PERSONAL },
  "GET /api/motion/status": { kind: "exempt", why: NOT_PERSONAL },
  "GET /api/motion/clip/[clipId]": { kind: "exempt", why: NOT_PERSONAL },
  "GET /api/gbd/status": { kind: "exempt", why: NOT_PERSONAL },
};

const originalEnv = { ...process.env };

beforeAll(async () => {
  // getVitronicConnectionStatus reads the BodyLoop config; synthetic values only.
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    LLM_PROVIDER: "ollama",
    DATA_MODE: "personal",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    VITRONIC_TOKEN_ENCRYPTION_KEY: "0".repeat(64),
  });
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
});

afterAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
});

const audited = Object.entries(PERSONAL_READ_ROUTES).filter(
  (entry): entry is [string, Audited] => entry[1].kind === "audited",
);

describe("every personal read route writes its audit rows", () => {
  for (const [route, entry] of audited) {
    test(route, async () => {
      const record = recorder();
      await entry.call(record);
      expect(record.rows.map((row) => row.tool)).toEqual([...entry.tools]);
      expect(
        record.rows.every((row) => row.actor === ACTOR || row.actor === APP_USER),
      ).toBe(true);
      expect(JSON.stringify(record.rows)).not.toContain(SUMMARY.narrative);
    });
  }

  test("the Data page's dataset list writes one row", async () => {
    const record = recorder();
    await loadYourData({
      resolveActorId: signedIn.resolveActorId,
      permit: () => true,
      findUserId: signedIn.findAppUserId,
      store: emptyStore,
      audit: record.append,
      sessionId: () => "session-1",
    });
    expect(record.rows.map((row) => row.tool)).toEqual(["personal-data.list"]);
  });

  test("the BodyLoop snapshot list is audited under the signed-in actor", async () => {
    const record = recorder();
    const entry =
      PERSONAL_READ_ROUTES["GET /api/vitronic/subjects/[subjectId]/snapshots"];
    if (entry?.kind !== "audited") throw new Error("snapshots must be audited");
    await entry.call(record);
    expect(record.rows.map((row) => row.actor)).toEqual([ACTOR]);
  });

  test("the scans reader writes vitronic.scans (it cannot take fakes yet)", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../features/vitronic/connection.ts"),
      "utf8",
    );
    const start = source.indexOf("export const listScansForSubject");
    const end = source.indexOf("export const", start + 1);
    expect(source.slice(start, end)).toContain("tool: VITRONIC_SCANS_AUDIT_TOOL");
  });
});

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const apiRoutes = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return apiRoutes(path);
    if (item.name !== "route.ts") return [];
    const source = readFileSync(path, "utf8");
    const route = `/${relative(join(import.meta.dir, "../.."), dir)
      .split(sep)
      .join("/")}`.replace(/^\/app/, "");
    // `export const GET =`, `export async function GET`, `export const { GET, POST } =`.
    return METHODS.filter((method) =>
      new RegExp(
        `export (const|(async )?function) ${method}\\b|export const \\{[^}]*\\b${method}\\b`,
      ).test(source),
    ).map((method) => `${method} ${route}`);
  });

describe("the list is complete", () => {
  test("every app/api route and method is listed above", () => {
    const found = apiRoutes(join(import.meta.dir, "../../app/api")).sort();
    expect(found).toEqual(Object.keys(PERSONAL_READ_ROUTES).sort());
  });
});
