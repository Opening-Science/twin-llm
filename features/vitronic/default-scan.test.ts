import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";

import type { AppendInput } from "@/packages/audit/append";

import type {
  setDefaultScanForSubject,
  VitronicDefaultScanNotFoundError,
} from "./connection";

const USER_ID = "user-synthetic-1";
const SUBJECT_ID = "subj-synthetic-1";
const ACTOR = "local";

const recorded = {
  appends: [] as AppendInput[],
  updates: [] as unknown[],
};

const dummyAppended = {
  seq: 1n,
  hash: "h",
  argsSha256: "a".repeat(64),
  resultSha256: "b".repeat(64),
};

const fakeDatabase = (opts: { subject: boolean; snapshot: boolean }) => () => ({
  vitronicSubject: {
    findFirst: async () => (opts.subject ? { id: SUBJECT_ID } : null),
    update: async (args: unknown) => {
      recorded.updates.push(args);
      const data = (args as { data: { defaultViatarId: number | null } }).data;
      return { defaultViatarId: data.defaultViatarId };
    },
  },
  vitronicSnapshot: {
    findFirst: async () => (opts.snapshot ? { id: "snap-synthetic" } : null),
  },
});

const recordingAppend = async (input: AppendInput) => {
  recorded.appends.push(input);
  return dummyAppended;
};

const originalEnv = { ...process.env };

let setDefault: typeof setDefaultScanForSubject;
let NotFound: typeof VitronicDefaultScanNotFoundError;
let TOOL: string;

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
  setDefault = connection.setDefaultScanForSubject;
  NotFound = connection.VitronicDefaultScanNotFoundError;
  TOOL = connection.VITRONIC_SUBJECT_DEFAULT_AUDIT_TOOL;
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
  recorded.updates.length = 0;
});

const run = (
  viatarId: number | null,
  db: { subject: boolean; snapshot: boolean },
  append: (input: AppendInput) => Promise<typeof dummyAppended> = recordingAppend,
) =>
  setDefault({
    userId: USER_ID,
    actor: ACTOR,
    subjectId: SUBJECT_ID,
    viatarId,
    ports: { append, database: fakeDatabase(db) },
  });

describe("setDefaultScanForSubject", () => {
  test("pins a stored scan and appends one vitronic.subjects.default event", async () => {
    const result = await run(22, { subject: true, snapshot: true });
    expect(result).toEqual({ defaultViatarId: 22 });
    expect(recorded.updates).toHaveLength(1);
    expect(recorded.appends).toHaveLength(1);
    const event = recorded.appends[0];
    expect(event?.tool).toBe(TOOL);
    expect(event?.subjectRef).toBe(SUBJECT_ID);
    expect(event?.actor).toBe(ACTOR);
    expect(event?.args).toEqual({ subjectId: SUBJECT_ID, viatarId: 22 });
    expect(event?.result).toEqual({ defaultViatarId: 22 });
  });

  test("null clears the pin without a snapshot lookup", async () => {
    const result = await run(null, { subject: true, snapshot: false });
    expect(result).toEqual({ defaultViatarId: null });
    expect(recorded.appends[0]?.args).toEqual({ subjectId: SUBJECT_ID, viatarId: null });
  });

  test("an unsynced scan is not found and nothing is written", async () => {
    await expect(run(99, { subject: true, snapshot: false })).rejects.toBeInstanceOf(
      NotFound,
    );
    expect(recorded.updates).toHaveLength(0);
    expect(recorded.appends).toHaveLength(0);
  });

  test("another user's subject is not found and nothing is written", async () => {
    await expect(run(22, { subject: false, snapshot: true })).rejects.toBeInstanceOf(
      NotFound,
    );
    expect(recorded.updates).toHaveLength(0);
    expect(recorded.appends).toHaveLength(0);
  });

  test("a failed audit append fails closed before the update", async () => {
    await expect(
      run(22, { subject: true, snapshot: true }, async () => {
        throw new Error("audit-down");
      }),
    ).rejects.toThrow("audit-down");
    expect(recorded.updates).toHaveLength(0);
  });
});
