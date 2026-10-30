import { readdirSync, readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";

import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { createThreadExportHandler } from "@/features/arena/thread-export-handler";
import { readConnectorSummaries } from "@/features/connectors/connector-summaries";
import { getGenomeReportResponse } from "@/features/digital-twin/genome-run";
import { createGoogleHealthCallbackHandler } from "@/features/google-health/oauth-handlers";
import { createOuraCallbackHandler } from "@/features/oura/oauth-handlers";
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
import {
  createWearableSyncHandler,
  type WearableSyncProvider,
} from "@/features/wearables/sync-handler";
import { createWhoopCallbackHandler } from "@/features/whoop/oauth-handlers";
import { auditPersonalRead } from "@/infrastructure/personal-read-audit";
import type { OAuthCookieJar } from "@/infrastructure/oauth-state";
import type { PersonalDataStore } from "@/infrastructure/personal-data-store";
import type { AppendInput } from "@/packages/audit/append";

/**
 * Every app/api route that reads personal data, and what it writes to the
 * audit chain (#143). Each `audited` entry calls the route's handler with
 * fakes (synthetic values only) and expects exactly the rows named, which is
 * one row per read for all of them but the wearables summary: that one reads
 * four sources and writes one row for Oura, Whoop and Google Health and one
 * in the BodyLoop reader. A wearable sync, from its route or the first sync
 * after an OAuth callback, writes one `personal.read.sync-<provider>` row counting the
 * metrics it stores (#223), before the snapshot is saved (#235).
 *
 * Pages are not API routes, so the pages that read wearable summaries have
 * their own list, `PERSONAL_READ_PAGES`, checked the same way.
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
  /** "row" per audit row and "save" per stored sync snapshot, in order. */
  events: string[];
  append: (input: AppendInput) => Promise<{
    seq: bigint;
    hash: string;
    argsSha256: string;
    resultSha256: string;
  }>;
}>;

/** With `failing`, every append throws, as when the audit chain is down. */
const recorder = (failing = false): Recorder => {
  const rows: AppendInput[] = [];
  const events: string[] = [];
  return {
    rows,
    events,
    append: async (input) => {
      if (failing) throw new Error("audit down");
      rows.push(input);
      events.push("row");
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

/** What a fake sync read: synthetic metric keys, counted by the sync row before it is saved. */
const SYNC_METRICS = [
  { key: "synthetic.metric.a", value: 1 },
  { key: "synthetic.metric.b", value: 2 },
  { key: "synthetic.metric.c", value: 3 },
];
const syncedSummary = (record: Recorder) => async () => ({
  synced: { ...SUMMARY, metrics: SYNC_METRICS },
  save: async () => {
    record.events.push("save");
  },
});

const SYNTHETIC_STATE = "abcd1234";
const stateJar: OAuthCookieJar = {
  get: () => ({ value: SYNTHETIC_STATE }),
  set: () => undefined,
  delete: () => undefined,
};
const callbackRequest = (provider: string) =>
  new Request(
    `http://localhost/api/${provider}/callback?code=synthetic-code&state=${SYNTHETIC_STATE}`,
  );

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

/** The sync route for one provider, with a fake sync and the recorder's append. */
const syncRoute = (provider: WearableSyncProvider): Audited => ({
  kind: "audited",
  tools: [`personal.read.sync-${provider}`],
  call: (record) =>
    createWearableSyncHandler({
      provider,
      isConfigured: () => true,
      ...signedIn,
      sync: syncedSummary(record),
      auditPersonalRead: auditPersonalRead(record.append),
      logError: () => undefined,
    })(new Request(`http://localhost/api/${provider}/sync`, { method: "POST" })),
});

/** The OAuth callback writes no health data itself; its first sync does. */
const callbackDeps = (record: Recorder) => ({
  isConfigured: () => true,
  resolveActorId: signedIn.resolveActorId,
  ensureAppUser: async () => ({ id: APP_USER }),
  readCookies: () => stateJar,
  exchangeAndPersistCode: async () => undefined,
  syncForUser: syncedSummary(record),
  auditPersonalRead: auditPersonalRead(record.append),
  logError: () => undefined,
  logWarn: () => undefined,
});

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
  "GET /api/oura/callback": {
    kind: "audited",
    tools: ["personal.read.sync-oura"],
    call: (record) =>
      createOuraCallbackHandler({
        ouraEnv: () => ({ configured: true }),
        resolveActorId: signedIn.resolveActorId,
        ensureAppUser: async () => ({ id: APP_USER }),
        readCookies: () => stateJar,
        createTokenHandlerFromCode: async () => ({
          lastTokens: () => ({
            access_token: "synthetic-access",
            refresh_token: "synthetic-refresh",
            expires_in: 3600,
          }),
        }),
        persistOuraTokens: async () => undefined,
        syncOuraForUser: syncedSummary(record),
        auditPersonalRead: auditPersonalRead(record.append),
        logError: () => undefined,
        logWarn: () => undefined,
      })(callbackRequest("oura")),
  },
  "DELETE /api/oura/disconnect": { kind: "exempt", why: OAUTH },
  "POST /api/oura/sync": syncRoute("oura"),
  "GET /api/whoop/authorize": { kind: "exempt", why: OAUTH },
  "GET /api/whoop/callback": {
    kind: "audited",
    tools: ["personal.read.sync-whoop"],
    call: (record) =>
      createWhoopCallbackHandler(callbackDeps(record))(callbackRequest("whoop")),
  },
  "DELETE /api/whoop/disconnect": { kind: "exempt", why: OAUTH },
  "POST /api/whoop/sync": syncRoute("whoop"),
  "GET /api/google-health/authorize": { kind: "exempt", why: OAUTH },
  "GET /api/google-health/callback": {
    kind: "audited",
    tools: ["personal.read.sync-google-health"],
    call: (record) =>
      createGoogleHealthCallbackHandler(callbackDeps(record))(
        callbackRequest("google-health"),
      ),
  },
  "DELETE /api/google-health/disconnect": { kind: "exempt", why: OAUTH },
  "POST /api/google-health/sync": syncRoute("google-health"),
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
  "GET /api/motion/days/[subjectRef]": {
    kind: "exempt",
    why: "synthetic Demo cohort only (its handler still writes motion.days)",
  },
  "GET /api/gbd/status": { kind: "exempt", why: NOT_PERSONAL },
  "POST /api/synthea/jobs": {
    kind: "exempt",
    why: "runs Synthea on closed options; every record it makes is synthetic",
  },
  "GET /api/synthea/jobs/[id]": { kind: "exempt", why: NOT_PERSONAL },
  "GET /api/synthea/jobs/[id]/download": { kind: "exempt", why: NOT_PERSONAL },
};

/** A direct call to a wearable summary reader, outside the audited reader. */
const SUMMARY_READ_CALL = /getLatest(Oura|Whoop|GoogleHealth|Vitronic)Summary\(/;

type PageEntry = Audited &
  Readonly<{
    /** The page file, from the repo root. */
    file: string;
    /** The audited reader the page must call; it must not read summaries itself. */
    reader: string;
  }>;

/** Pages (not API routes) that read wearable summaries → their audit rows. */
const PERSONAL_READ_PAGES: Readonly<Record<string, PageEntry>> = {
  "/customize/connectors": {
    kind: "audited",
    file: "app/(shell)/customize/connectors/page.tsx",
    reader: "readConnectorSummaries(",
    tools: ["personal.read.connectors-page"],
    call: (record) =>
      readConnectorSummaries(
        {
          isPersonalMode: () => true,
          getLatestOuraSummary: async () => SUMMARY,
          getLatestWhoopSummary: async () => null,
          getLatestGoogleHealthSummary: async () => SUMMARY,
          auditPersonalRead: auditPersonalRead(record.append),
        },
        ACTOR,
        APP_USER,
      ),
  },
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

  for (const [page, entry] of Object.entries(PERSONAL_READ_PAGES)) {
    test(`page ${page}`, async () => {
      const record = recorder();
      await entry.call(record);
      expect(record.rows.map((row) => row.tool)).toEqual([...entry.tools]);
      expect(record.rows.map((row) => row.actor)).toEqual([ACTOR]);
      expect(JSON.stringify(record.rows)).not.toContain(SUMMARY.narrative);
    });

    test(`page ${page} reads its summaries through the audited reader`, () => {
      const source = readFileSync(join(import.meta.dir, "../..", entry.file), "utf8");
      expect(source).toContain(entry.reader);
      expect(source).not.toMatch(SUMMARY_READ_CALL);
    });
  }

  test("every sync row counts the metrics written, never a value", async () => {
    const syncs = audited.filter(([, entry]) =>
      entry.tools.some((tool) => tool.startsWith("personal.read.sync-")),
    );
    expect(syncs.map(([route]) => route).sort()).toEqual([
      "GET /api/google-health/callback",
      "GET /api/oura/callback",
      "GET /api/whoop/callback",
      "POST /api/google-health/sync",
      "POST /api/oura/sync",
      "POST /api/whoop/sync",
    ]);
    for (const [, entry] of syncs) {
      const record = recorder();
      await entry.call(record);
      expect(record.rows.map((row) => row.rowCount)).toEqual([SYNC_METRICS.length]);
      expect(JSON.stringify(record.rows)).not.toContain("synthetic.metric");
      expect(record.events).toEqual(["row", "save"]);
    }
  });

  test("a sync whose row cannot be written stores no snapshot (#235)", async () => {
    const syncs = audited.filter(([, entry]) =>
      entry.tools.some((tool) => tool.startsWith("personal.read.sync-")),
    );
    expect(syncs.length).toBe(6);
    for (const [route, entry] of syncs) {
      const record = recorder(true);
      await entry.call(record);
      expect([route, record.rows, record.events]).toEqual([route, [], []]);
    }
  });

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

const pagesReadingSummaries = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return pagesReadingSummaries(path);
    if (item.name !== "page.tsx" && item.name !== "layout.tsx") return [];
    const source = readFileSync(path, "utf8");
    if (
      !/getLatest(Oura|Whoop|GoogleHealth|Vitronic)Summary|readConnectorSummaries/.test(
        source,
      )
    ) {
      return [];
    }
    return [
      relative(join(import.meta.dir, "../.."), path)
        .split(sep)
        .join("/"),
    ];
  });

describe("the list is complete", () => {
  test("every page that reads wearable summaries is listed above", () => {
    const found = pagesReadingSummaries(join(import.meta.dir, "../../app")).sort();
    expect(found).toEqual(
      Object.values(PERSONAL_READ_PAGES)
        .map((entry) => entry.file)
        .sort(),
    );
  });

  test("every app/api route and method is listed above", () => {
    const found = apiRoutes(join(import.meta.dir, "../../app/api")).sort();
    expect(found).toEqual(Object.keys(PERSONAL_READ_ROUTES).sort());
  });
});
