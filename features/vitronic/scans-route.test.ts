import { describe, expect, test } from "bun:test";

import { createVitronicScansHandler, type VitronicScansDeps } from "./scans-handler";

const OWNER = "user-owner";
let actor: string | null = OWNER;
let requestedSubject: string | null = null;

const scansDeps = (): VitronicScansDeps => ({
  vitronicEnv: () => ({ encryptionKey: "synthetic", dataDir: null }),
  resolveActorId: async () => actor,
  findAppUserId: async (clerkId: string) => (clerkId ? clerkId : null),
  listScansForSubject: async (params: { subjectId: string }) => {
    requestedSubject = params.subjectId;
    return [
      {
        viatarId: 4,
        crtime: "2026-09-01T00:00:00Z",
        synced: true,
        incomplete: false,
        presetName: null,
      },
      {
        viatarId: 9,
        crtime: "2026-08-01T00:00:00Z",
        synced: false,
        incomplete: true,
        presetName: "Marker Only",
      },
    ];
  },
});

describe("GET /api/vitronic/subjects/:id/scans", () => {
  test("returns id, crtime, synced, incomplete, and presetName for every listed viatar", async () => {
    actor = OWNER;
    requestedSubject = null;
    const GET = createVitronicScansHandler(scansDeps());
    const res = await GET(
      new Request("http://local/api/vitronic/subjects/sub-self/scans"),
      {
        params: Promise.resolve({ subjectId: "sub-self" }),
      },
    );
    expect(res.status).toBe(200);
    expect(requestedSubject).toBe("sub-self");
    const body = (await res.json()) as { scans: Array<Record<string, unknown>> };
    expect(body.scans).toEqual([
      {
        viatarId: 4,
        crtime: "2026-09-01T00:00:00Z",
        synced: true,
        incomplete: false,
        presetName: null,
      },
      {
        viatarId: 9,
        crtime: "2026-08-01T00:00:00Z",
        synced: false,
        incomplete: true,
        presetName: "Marker Only",
      },
    ]);
    expect(body.scans.some((row) => row.incomplete === true)).toBe(true);
  });
});
