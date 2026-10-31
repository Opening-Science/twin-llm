import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";

const USER_ID = "user-synthetic-1";
const SUBJECT_ID = "subj-synthetic-1";
const ACTOR = "local";

const SUMMARY: VitronicSummary = {
  window: { startDate: "2026-01-01", endDate: "2026-01-01" },
  narrative: "fixture-narrative-must-not-audit",
  metrics: [
    {
      key: ["vitronic.property", "body.height", "2026-01-01"].join("."),
      label: "height",
      value: 1.75,
      unit: "m",
    },
  ],
};

const subjectRow = {
  id: SUBJECT_ID,
  label: "Self",
  source: "scanner",
  isSelf: true,
  probandId: 7,
  defaultViatarId: null,
};

const snapshotRow = {
  id: "snap-synthetic-1",
  viatarId: 4,
  glbSha256: "aa".repeat(32),
  syncedAt: new Date("2026-01-01T00:00:00.000Z"),
  // Text columns since #141; a synthetic install stores the JSON as it is.
  summary: JSON.stringify(SUMMARY),
  markers: JSON.stringify([{ at: "synthetic" }]),
  measures: JSON.stringify([{ value: 99 }]),
  presetName: "Default",
  subjectId: SUBJECT_ID,
};

const connectionRow = {
  lastSyncAt: new Date("2026-01-02T00:00:00.000Z"),
  tlsFingerprintSha256: "synthetic-tls-fingerprint-sha256-must-not-audit",
};

const recorded = {
  appends: [] as AppendInput[],
};

const dummyAppended = {
  seq: 1n,
  hash: "h",
  argsSha256: "a".repeat(64),
  resultSha256: "b".repeat(64),
};

const fakeDatabase = () => ({
  vitronicSubject: {
    findMany: async () => [subjectRow],
  },
  vitronicConnection: {
    findUnique: async () => connectionRow,
  },
  vitronicSnapshot: {
    findMany: async () => [snapshotRow],
    findFirst: async () => snapshotRow,
  },
});

const originalEnv = { ...process.env };

const recordingAppend = async (input: AppendInput) => {
  recorded.appends.push(input);
  return dummyAppended;
};

const recordingPorts = {
  append: recordingAppend,
  database: fakeDatabase,
};

type LocalReadOpts = {
  readonly actor?: string;
  readonly ports?: {
    append?: (input: AppendInput) => Promise<typeof dummyAppended>;
    database?: typeof fakeDatabase;
  };
  readonly auditTool?: string;
};

let listSubjects: (userId: string, opts?: LocalReadOpts) => Promise<readonly unknown[]>;
let listSnapshots: (
  userId: string,
  subjectId: string,
  opts?: LocalReadOpts,
) => Promise<readonly unknown[]>;
let latestSummary: (
  userId: string,
  opts?: LocalReadOpts,
) => Promise<VitronicSummary | null>;
let connectionStatus: (userId: string, opts?: LocalReadOpts) => Promise<unknown>;
let toChatVitronicSummary: (summary: VitronicSummary) => VitronicSummary;
let VITRONIC_SUBJECTS_LIST_AUDIT_TOOL: string;
let VITRONIC_SNAPSHOTS_LIST_AUDIT_TOOL: string;
let VITRONIC_CHAT_SUMMARY_AUDIT_TOOL: string;
let VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL: string;
let VITRONIC_CONNECTION_STATUS_AUDIT_TOOL: string;

beforeAll(async () => {
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    LLM_PROVIDER: "ollama",
    DATA_MODE: "synthetic",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    VITRONIC_TOKEN_ENCRYPTION_KEY: "0".repeat(64),
  });
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
  const connection = await import("./connection");
  const reads = connection.localVitronicReads;
  listSubjects = reads.listSubjects;
  listSnapshots = reads.listSnapshots;
  latestSummary = reads.latestSummary;
  connectionStatus = reads.connectionStatus;
  VITRONIC_SUBJECTS_LIST_AUDIT_TOOL = connection.VITRONIC_SUBJECTS_LIST_AUDIT_TOOL;
  VITRONIC_SNAPSHOTS_LIST_AUDIT_TOOL = connection.VITRONIC_SNAPSHOTS_LIST_AUDIT_TOOL;
  VITRONIC_CHAT_SUMMARY_AUDIT_TOOL = connection.VITRONIC_CHAT_SUMMARY_AUDIT_TOOL;
  VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL =
    connection.VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL;
  VITRONIC_CONNECTION_STATUS_AUDIT_TOOL =
    connection.VITRONIC_CONNECTION_STATUS_AUDIT_TOOL;
  ({ toChatVitronicSummary } = await import("@/packages/vitronic/summary"));
});

afterAll(async () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) Reflect.deleteProperty(process.env, key);
  }
  Object.assign(process.env, originalEnv);
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
});

beforeEach(() => {
  recorded.appends.length = 0;
});

const opts = { actor: ACTOR, ports: recordingPorts };

describe("local Vitronic Prisma read audit", () => {
  test("listVitronicSubjects appends one vitronic.subjects.list event", async () => {
    await listSubjects(USER_ID, opts);
    expect(recorded.appends).toHaveLength(1);
    expect(recorded.appends[0]?.tool).toBe(VITRONIC_SUBJECTS_LIST_AUDIT_TOOL);
    expect(recorded.appends[0]?.rowCount).toBe(1);
    expect(recorded.appends[0]?.subjectRef).toBeNull();
    expect(recorded.appends[0]?.args).toEqual({ count: 1 });
  });

  test("listSnapshotsForSubject appends one vitronic.snapshots.list event", async () => {
    await listSnapshots(USER_ID, SUBJECT_ID, opts);
    expect(recorded.appends).toHaveLength(1);
    expect(recorded.appends[0]?.tool).toBe(VITRONIC_SNAPSHOTS_LIST_AUDIT_TOOL);
    expect(recorded.appends[0]?.rowCount).toBe(1);
    expect(recorded.appends[0]?.subjectRef).toBe(SUBJECT_ID);
    expect(recorded.appends[0]?.args).toEqual({ subjectId: SUBJECT_ID, count: 1 });
  });

  test("getLatestVitronicSummary appends one vitronic.chat.summary event", async () => {
    await latestSummary(USER_ID, opts);
    expect(recorded.appends).toHaveLength(1);
    expect(recorded.appends[0]?.tool).toBe(VITRONIC_CHAT_SUMMARY_AUDIT_TOOL);
    expect(recorded.appends[0]?.rowCount).toBe(1);
    expect(recorded.appends[0]?.subjectRef).toBe(SUBJECT_ID);
    expect(recorded.appends[0]?.args).toEqual({ count: 1 });
  });

  test("getLatestVitronicSummary with auditTool appends vitronic.wearables.summary", async () => {
    await latestSummary(USER_ID, {
      ...opts,
      auditTool: VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL,
    });
    expect(recorded.appends).toHaveLength(1);
    expect(recorded.appends[0]?.tool).toBe(VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL);
    expect(recorded.appends[0]?.rowCount).toBe(1);
    expect(recorded.appends[0]?.subjectRef).toBe(SUBJECT_ID);
    expect(recorded.appends[0]?.args).toEqual({ count: 1 });
  });

  test("getVitronicConnectionStatus appends one vitronic.connection.status event", async () => {
    await connectionStatus(USER_ID, opts);
    expect(recorded.appends).toHaveLength(1);
    expect(recorded.appends[0]?.tool).toBe(VITRONIC_CONNECTION_STATUS_AUDIT_TOOL);
    expect(recorded.appends[0]?.rowCount).toBe(2);
    expect(recorded.appends[0]?.subjectRef).toBe(SUBJECT_ID);
    expect(recorded.appends[0]?.args).toEqual({ connected: true, count: 1 });
    expect(recorded.appends[0]?.result).toEqual({ connected: true, count: 1 });
  });

  test("chat summary path appends once even when toChatVitronicSummary is applied twice", async () => {
    const first = await latestSummary(USER_ID, opts);
    expect(first).not.toBeNull();
    toChatVitronicSummary(first as VitronicSummary);
    expect(recorded.appends).toHaveLength(1);
    expect(recorded.appends[0]?.tool).toBe(VITRONIC_CHAT_SUMMARY_AUDIT_TOOL);
  });

  test("audit args hold ids and counts only, never measure values", async () => {
    await listSubjects(USER_ID, opts);
    await listSnapshots(USER_ID, SUBJECT_ID, opts);
    await latestSummary(USER_ID, opts);
    await connectionStatus(USER_ID, opts);
    const blob = JSON.stringify(recorded.appends);
    expect(blob).not.toContain("1.75");
    expect(blob).not.toContain("fixture-narrative-must-not-audit");
    expect(blob).not.toContain("markers");
    expect(blob).not.toContain("measures");
    expect(blob).not.toContain("narrative");
    expect(blob).not.toContain("synthetic-tls-fingerprint-sha256-must-not-audit");
    expect(blob).not.toContain("https://");
  });

  test("omitted actor defaults to the user id", async () => {
    await listSubjects(USER_ID, { ports: recordingPorts });
    expect(recorded.appends).toHaveLength(1);
    expect(recorded.appends[0]?.actor).toBe(USER_ID);
  });

  test("a failed audit append fails the read", async () => {
    const failing = {
      append: async () => {
        throw new Error("audit-down");
      },
      database: fakeDatabase,
    };
    await expect(listSubjects(USER_ID, { actor: ACTOR, ports: failing })).rejects.toThrow(
      "audit-down",
    );
    await expect(
      listSnapshots(USER_ID, SUBJECT_ID, { actor: ACTOR, ports: failing }),
    ).rejects.toThrow("audit-down");
    await expect(
      latestSummary(USER_ID, { actor: ACTOR, ports: failing }),
    ).rejects.toThrow("audit-down");
    await expect(
      latestSummary(USER_ID, {
        actor: ACTOR,
        ports: failing,
        auditTool: VITRONIC_WEARABLES_SUMMARY_AUDIT_TOOL,
      }),
    ).rejects.toThrow("audit-down");
    await expect(
      connectionStatus(USER_ID, { actor: ACTOR, ports: failing }),
    ).rejects.toThrow("audit-down");
  });
});
