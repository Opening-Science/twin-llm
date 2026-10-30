import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AppendInput } from "@/packages/audit/append";
import { buildTinyGlb } from "@/packages/vitronic/tiny-glb";
import type { VitronicSummary } from "@/infrastructure/vitronic-types";

import type { VitronicIngestInput, VitronicSnapshotPorts } from "./connection";
import type { createVitronicSyncHandler as CreateSyncHandler } from "./sync-handler";
import { SYNTHETIC_INGEST_BODY } from "./fixtures/synthetic-measurements";

const USER_ID = "user-synthetic-1";
const OTHER_USER_ID = "user-synthetic-2";
const ACTOR = "local";

/** Subject id -> owning user, as the subjects table would answer. */
const SUBJECT_OWNERS: Readonly<Record<string, string>> = {
  "sub-self": USER_ID,
  "sub-file": USER_ID,
  "sub-other": OTHER_USER_ID,
};

const recorded = {
  snapshots: [] as {
    where: unknown;
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }[],
  connectionUpdates: [] as { where: { userId: string }; data: Record<string, unknown> }[],
  appends: [] as AppendInput[],
};

const testPorts = (): Partial<VitronicSnapshotPorts> => ({
  database: () => ({
    vitronicSubject: {
      findFirst: async (args: {
        where: { id: string; userId: string };
        select: { id: true };
      }) =>
        SUBJECT_OWNERS[args.where.id] === args.where.userId
          ? { id: args.where.id }
          : null,
    },
    vitronicSnapshot: {
      upsert: async (args: {
        where: { subjectId_viatarId: { subjectId: string; viatarId: number } };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        recorded.snapshots.push(args);
        return {};
      },
    },
    vitronicConnection: {
      updateMany: async (args: {
        where: { userId: string };
        data: { lastSyncAt: Date };
      }) => {
        recorded.connectionUpdates.push(args);
        return { count: 0 };
      },
    },
  }),
  append: async (input) => {
    recorded.appends.push(input);
    return {
      seq: 1n,
      hash: "h",
      argsSha256: "a".repeat(64),
      resultSha256: "b".repeat(64),
    };
  },
  persistGlb,
});

const originalEnv = { ...process.env };
let dataDir = "";
let persistGlb: (userId: string, bytes: Uint8Array) => Promise<string>;
let VitronicSubjectNotOwnedError: new () => Error;
let createVitronicSyncHandler: typeof CreateSyncHandler;
let ingestVitronicForUser: (params: {
  readonly userId: string;
  readonly actor: string;
  readonly input: VitronicIngestInput;
  readonly ports?: Partial<VitronicSnapshotPorts>;
}) => Promise<{
  readonly summary: VitronicSummary;
  readonly glbSha256: string | null;
  readonly fhirBundle: null;
  readonly viatarId: number;
}>;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), "vitronic-"));
  Object.assign(process.env, {
    LOCAL_MVP: "true",
    AUTH_DISABLED: "true",
    LLM_PROVIDER: "ollama",
    DATA_MODE: "synthetic",
    DATABASE_URL: "postgresql://synthetic@localhost:1/none",
    VITRONIC_TOKEN_ENCRYPTION_KEY: "0".repeat(64),
    VITRONIC_DATA_DIR: dataDir,
  });
  const { resetServerEnvCacheForTests } = await import("@/infrastructure/env");
  resetServerEnvCacheForTests();
  ({ persistGlb } = await import("@/packages/vitronic/glb"));
  ({ ingestVitronicForUser, VitronicSubjectNotOwnedError } =
    await import("./connection"));
  ({ createVitronicSyncHandler } = await import("./sync-handler"));
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
  recorded.snapshots.length = 0;
  recorded.connectionUpdates.length = 0;
  recorded.appends.length = 0;
});

describe("ingestVitronicForUser", () => {
  test("stores exact summary keys, leaves fhirBundle null, and hashes the glb", async () => {
    const glb = buildTinyGlb();
    const expectedSha = createHash("sha256").update(glb).digest("hex");

    const result = await ingestVitronicForUser({
      userId: USER_ID,
      actor: ACTOR,
      input: {
        ...SYNTHETIC_INGEST_BODY,
        subjectId: "sub-self",
        glb,
        glb,
        glbModelName: "avatar_3d.glb",
      },
      ports: testPorts(),
    });

    expect(result.glbSha256).toBe(expectedSha);
    expect(
      result.summary.metrics.map(
        (metric) => `${metric.key} ${metric.value} ${metric.unit}`,
      ),
    ).toEqual([
      "vitronic.property.body.height.2026-07-10 1.7 m",
      "vitronic.property.body.surface.2026-07-10 1.85 m2",
      "vitronic.property.body.volume.2026-07-10 0.065 m3",
      "vitronic.property.body.mass.2026-07-10 68 kg",
      "vitronic.property.body.bmi.2026-07-10 21 kg/m2",
    ]);
    expect(
      result.summary.metrics.every((metric) => typeof metric.unit === "string"),
    ).toBe(true);
    expect(result.fhirBundle).toBeNull();
    expect(recorded.snapshots).toHaveLength(1);
    const row = recorded.snapshots[0]?.create;
    expect(row?.summary).toEqual(result.summary);
    expect(row?.fhirBundle).toBeNull();
    expect(row?.glbSha256).toBe(expectedSha);
    expect(row?.glbModelName).toBe("avatar_3d.glb");
    expect(row?.subjectId).toBe("sub-self");
    expect(row?.viatarId).toBe(1);

    const onDisk = await readFile(join(dataDir, USER_ID, `${expectedSha}.glb`));
    expect(createHash("sha256").update(onDisk).digest("hex")).toBe(expectedSha);
    // Owner-only whatever the umask (#144).
    expect((await stat(join(dataDir, USER_ID))).mode & 0o777).toBe(0o700);
    expect((await stat(join(dataDir, USER_ID, `${expectedSha}.glb`))).mode & 0o777).toBe(
      0o600,
    );

    expect(recorded.appends).toHaveLength(1);
    expect(recorded.appends[0]?.tool).toBe("vitronic.sync");
    expect(recorded.appends[0]?.rowCount).toBe(0);
    expect(recorded.appends[0]?.subjectRef).toBe("sub-self");
  });

  test("stores marker and measure geometry on the snapshot, not in the chat summary", async () => {
    const result = await ingestVitronicForUser({
      userId: USER_ID,
      actor: ACTOR,
      input: {
        subjectId: "sub-self",
        scan_id: 1,
        marker: [
          {
            marker_type: "AutoMarker",
            marker_path: "head.vertex",
            label: "Vertex",
            position: [0, 0, 1.5],
          },
        ],
        height: [
          {
            height_path: "head.vertex",
            height: 1.5,
            at_marker: "head.vertex",
            details: {
              at_marker: {
                marker_type: "AutoMarker",
                marker_path: "head.vertex",
                position: [0, 0, 1.5],
                normal: [0, 0, 1],
              },
            },
          },
        ],
      },
      ports: testPorts(),
    });

    const row = recorded.snapshots[0]?.create;
    expect(Array.isArray(row?.markers)).toBe(true);
    expect((row?.markers as { path: string }[])[0]?.path).toBe("head.vertex");
    expect(Array.isArray(row?.measures)).toBe(true);
    expect(JSON.stringify(result.summary)).not.toContain("position");
    expect(JSON.stringify(result.summary)).not.toContain("contour");
  });

  test("glb-only ingest stores a mesh without measurements", async () => {
    const glb = buildTinyGlb();
    const result = await ingestVitronicForUser({
      userId: USER_ID,
      actor: ACTOR,
      input: {
        subjectId: "sub-file",
        glb,
        glbModelName: "avatar_3d.glb",
      },
      ports: testPorts(),
    });
    expect(result.glbSha256).toBeTruthy();
    expect(result.summary.metrics).toEqual([]);
    expect(recorded.snapshots[0]?.create.glbModelName).toBe("avatar_3d.glb");
    expect(Number.isInteger(recorded.snapshots[0]?.create.viatarId)).toBe(true);
  });

  test("re-ingest upserts the same subjectId+viatarId and writes markers on update", async () => {
    const first = buildTinyGlb();
    await ingestVitronicForUser({
      userId: USER_ID,
      actor: ACTOR,
      input: {
        subjectId: "sub-self",
        scan_id: 4,
        glb: first,
        glbModelName: "avatar_3d.glb",
      },
      ports: testPorts(),
    });
    const second = buildTinyGlb();
    second[second.length - 1] = (second[second.length - 1] ?? 0) ^ 1;
    await ingestVitronicForUser({
      userId: USER_ID,
      actor: ACTOR,
      input: {
        subjectId: "sub-self",
        scan_id: 4,
        glb: second,
        glbModelName: "avatar_3d.glb",
        marker: [
          {
            marker_type: "AutoMarker",
            marker_path: "head.vertex",
            label: "Vertex",
            position: [0, 0, 1.5],
          },
        ],
      },
      ports: testPorts(),
    });
    expect(recorded.snapshots).toHaveLength(2);
    const where = { subjectId_viatarId: { subjectId: "sub-self", viatarId: 4 } };
    expect(recorded.snapshots[0]?.where).toEqual(where);
    expect(recorded.snapshots[1]?.where).toEqual(where);
    expect(recorded.snapshots[1]?.update.glbSha256).toBeTruthy();
    expect(Array.isArray(recorded.snapshots[1]?.update.markers)).toBe(true);
    expect((recorded.snapshots[1]?.update.markers as { path: string }[])[0]?.path).toBe(
      "head.vertex",
    );
  });
});

describe("snapshot writes are scoped to the subject's owner", () => {
  test("a write naming another user's subject is refused, audited, and writes nothing", async () => {
    const glb = buildTinyGlb();
    glb[glb.length - 1] = (glb[glb.length - 1] ?? 0) ^ 2;
    const glbFile = `${createHash("sha256").update(glb).digest("hex")}.glb`;
    const attempt = ingestVitronicForUser({
      userId: USER_ID,
      actor: ACTOR,
      input: { ...SYNTHETIC_INGEST_BODY, subjectId: "sub-other", glb },
      ports: testPorts(),
    });
    await expect(attempt).rejects.toBeInstanceOf(VitronicSubjectNotOwnedError);
    expect(recorded.snapshots).toEqual([]);
    expect(recorded.connectionUpdates).toEqual([]);
    const stored = await readdir(join(dataDir, USER_ID)).catch((): string[] => []);
    expect(stored.includes(glbFile)).toBe(false);
    expect(recorded.appends).toEqual([
      {
        actor: ACTOR,
        sessionId: USER_ID,
        subjectRef: null,
        tool: "vitronic.write.refused",
        args: { subjectId: "sub-other", tool: "vitronic.sync" },
        result: { refused: true },
        rowCount: 0,
      },
    ]);
  });

  test("the owner's write sets userId on both create and update", async () => {
    await ingestVitronicForUser({
      userId: OTHER_USER_ID,
      actor: ACTOR,
      input: { subjectId: "sub-other", scan_id: 9 },
      ports: testPorts(),
    });
    expect(recorded.snapshots[0]?.where).toEqual({
      subjectId_viatarId: { subjectId: "sub-other", viatarId: 9 },
    });
    expect(recorded.snapshots[0]?.create.userId).toBe(OTHER_USER_ID);
    expect(recorded.snapshots[0]?.update.userId).toBe(OTHER_USER_ID);
  });

  test("POST /api/vitronic/sync with another user's subjectId answers 404", async () => {
    const POST = createVitronicSyncHandler({
      vitronicEnv: () => ({ encryptionKey: "synthetic", dataDir: null }),
      resolveActorId: async () => ACTOR,
      findAppUserId: async () => USER_ID,
      ingestVitronicForUser: (params) =>
        ingestVitronicForUser({ ...params, ports: testPorts() }),
      syncVitronicForUser: async () => {
        throw new Error("not used");
      },
    });
    const res = await POST(
      new Request("http://local/api/vitronic/sync", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...SYNTHETIC_INGEST_BODY, subjectId: "sub-other" }),
      }),
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found." });
    expect(recorded.snapshots).toEqual([]);
    expect(recorded.appends.map((event) => event.tool)).toEqual([
      "vitronic.write.refused",
    ]);
  });
});
