import { describe, expect, test } from "bun:test";

import { VitronicDefaultScanNotFoundError } from "./connection";
import {
  createVitronicDefaultScanPutHandler,
  type VitronicDefaultScanDeps,
} from "./default-scan-handler";

const OWNER = "user-owner";
const SUBJECT_ID = "sub-synthetic";

type Call = Parameters<VitronicDefaultScanDeps["setDefaultScanForSubject"]>[0];

const deps = (
  overrides: Partial<VitronicDefaultScanDeps> = {},
  calls: Call[] = [],
): VitronicDefaultScanDeps => ({
  vitronicEnv: () => ({ encryptionKey: "synthetic", dataDir: null }),
  resolveActorId: async () => OWNER,
  findAppUserId: async (clerkId: string) => clerkId,
  setDefaultScanForSubject: async (params) => {
    calls.push(params);
    return { defaultViatarId: params.viatarId };
  },
  ...overrides,
});

const put = (body: unknown) =>
  new Request(`http://local/api/vitronic/subjects/${SUBJECT_ID}/default`, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const context = { params: Promise.resolve({ subjectId: SUBJECT_ID }) };

describe("PUT /api/vitronic/subjects/:id/default", () => {
  test("pins a scan for the signed-in actor's subject", async () => {
    const calls: Call[] = [];
    const res = await createVitronicDefaultScanPutHandler(deps({}, calls))(
      put({ viatarId: 22 }),
      context,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, defaultViatarId: 22 });
    expect(calls).toEqual([
      { userId: OWNER, actor: OWNER, subjectId: SUBJECT_ID, viatarId: 22 },
    ]);
  });

  test("null clears the pin", async () => {
    const calls: Call[] = [];
    const res = await createVitronicDefaultScanPutHandler(deps({}, calls))(
      put({ viatarId: null }),
      context,
    );
    expect(res.status).toBe(200);
    expect(calls[0]?.viatarId).toBeNull();
  });

  test("rejects a missing, zero, or fractional viatarId with 400", async () => {
    const calls: Call[] = [];
    const PUT = createVitronicDefaultScanPutHandler(deps({}, calls));
    for (const body of [{}, { viatarId: 0 }, { viatarId: 2.5 }, { viatarId: "22" }]) {
      const res = await PUT(put(body), context);
      expect(res.status).toBe(400);
    }
    expect(calls).toHaveLength(0);
  });

  test("401 when signed out, 503 when BodyLoop is not configured", async () => {
    const signedOut = await createVitronicDefaultScanPutHandler(
      deps({ resolveActorId: async () => null }),
    )(put({ viatarId: 22 }), context);
    expect(signedOut.status).toBe(401);
    const unconfigured = await createVitronicDefaultScanPutHandler(
      deps({ vitronicEnv: () => null }),
    )(put({ viatarId: 22 }), context);
    expect(unconfigured.status).toBe(503);
  });

  test("unsynced scan or foreign subject is 404", async () => {
    const res = await createVitronicDefaultScanPutHandler(
      deps({
        setDefaultScanForSubject: async () => {
          throw new VitronicDefaultScanNotFoundError();
        },
      }),
    )(put({ viatarId: 99 }), context);
    expect(res.status).toBe(404);
  });

  test("audit failure is a generic 502 without provider text", async () => {
    const res = await createVitronicDefaultScanPutHandler(
      deps({
        setDefaultScanForSubject: async () => {
          throw new Error("audit-down");
        },
      }),
    )(put({ viatarId: 22 }), context);
    expect(res.status).toBe(502);
    const blob = JSON.stringify(await res.json());
    expect(blob).toContain("Could not save the default BodyLoop scan.");
    expect(blob).not.toContain("audit-down");
    expect(blob.toLowerCase()).not.toContain("prisma");
  });
});
