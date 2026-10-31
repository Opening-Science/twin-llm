import { describe, expect, test } from "bun:test";

import { MAX_GLB_BYTES } from "@/packages/vitronic/glb";
import { CLOUD_CONNECT_SHAPE_PENDING } from "@/packages/vitronic/push";

import { createSkipThrottle } from "./skip-throttle";
import { createVitronicUploadHandler, type VitronicUploadDeps } from "./upload-handler";

const CONNECTION_ID = "conn-synthetic-1";
const OTHER_CONNECTION_ID = "conn-synthetic-other";
const KEY_EXTERNAL = "twin-synthetic-1";
const SECRET = "upload-secret-synthetic";

const ACTOR = "actor-synthetic-1";

const uploadDeps = (overrides: Partial<VitronicUploadDeps> = {}): VitronicUploadDeps => ({
  vitronicEnv: () => ({ encryptionKey: "synthetic", dataDir: null }),
  findConnectionForUpload: async (connectionId: string) => {
    if (connectionId !== CONNECTION_ID) return null;
    return {
      id: CONNECTION_ID,
      userId: "user-synthetic-1",
      actorId: ACTOR,
      uploadSecretEnc: "enc",
    };
  },
  vaultOpen: () => true,
  openUploadSecret: async () => SECRET,
  appendAudit: async () => undefined,
  mayAuditSkip: () => true,
  logError: () => undefined,
  ...overrides,
});

type UploadPost = (
  request: Request,
  context: { params: Promise<{ connectionId: string }> },
) => Promise<Response>;

const callPost = (POST: UploadPost, connectionId: string, init: RequestInit) =>
  POST(new Request(`http://localhost/api/vitronic/upload/${connectionId}`, init), {
    params: Promise.resolve({ connectionId }),
  });

describe("POST /api/vitronic/upload/[connectionId]", () => {
  test("rejects a wrong shared secret for that connection", async () => {
    const POST = createVitronicUploadHandler(uploadDeps());
    const res = await callPost(POST, CONNECTION_ID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: [KEY_EXTERNAL, "nope"] }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(JSON.stringify(body)).not.toContain("nope");
  });

  test("rejects a secret that belongs to a different connection", async () => {
    const POST = createVitronicUploadHandler(uploadDeps());
    const res = await callPost(POST, OTHER_CONNECTION_ID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: [KEY_EXTERNAL, SECRET] }),
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  test("rejects a body over 100 MiB from Content-Length", async () => {
    const POST = createVitronicUploadHandler(uploadDeps());
    const res = await callPost(POST, CONNECTION_ID, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(MAX_GLB_BYTES + 1),
      },
      body: "{}",
    });
    expect(res.status).toBe(413);
  });

  test("good secret still returns 501 until the cloud_connect shape is known", async () => {
    const POST = createVitronicUploadHandler(uploadDeps());
    const res = await callPost(POST, CONNECTION_ID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: [KEY_EXTERNAL, SECRET] }),
    });
    expect(res.status).toBe(501);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe(CLOUD_CONNECT_SHAPE_PENDING);
    expect(JSON.stringify(body)).not.toContain(SECRET);
  });

  test("locked: the secret is not opened, 423, and a skip row says why (#341)", async () => {
    const rows: unknown[] = [];
    let opened = 0;
    const POST = createVitronicUploadHandler(
      uploadDeps({
        vaultOpen: () => false,
        openUploadSecret: async () => {
          opened += 1;
          return SECRET;
        },
        appendAudit: async (input) => {
          rows.push(input);
        },
      }),
    );
    const res = await callPost(POST, CONNECTION_ID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: [KEY_EXTERNAL, SECRET] }),
    });
    expect(res.status).toBe(423);
    expect(await res.json()).toEqual({
      error: "Your data is locked. Unlock it to continue.",
    });
    expect(opened).toBe(0);
    expect(rows).toEqual([
      {
        actor: ACTOR,
        sessionId: ACTOR,
        subjectRef: null,
        tool: "vault.locked.skip.bodyloop-upload",
        args: { step: "bodyloop-upload" },
        result: { decision: "skipped: locked" },
        rowCount: 0,
      },
    ]);
  });

  test("a vault that locks between the check and the read is a skip too", async () => {
    const tools: string[] = [];
    const POST = createVitronicUploadHandler(
      uploadDeps({
        openUploadSecret: async () => Promise.reject(new Error("locked")),
        appendAudit: async (input) => {
          tools.push(input.tool);
        },
      }),
    );
    const res = await callPost(POST, CONNECTION_ID, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: [KEY_EXTERNAL, SECRET] }),
    });
    expect(res.status).toBe(423);
    expect(tools).toEqual(["vault.locked.skip.bodyloop-upload"]);
  });

  const lockedPost = (POST: UploadPost, connectionId: string) =>
    callPost(POST, connectionId, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auth: [KEY_EXTERNAL, SECRET] }),
    });

  test("locked uploads write one skip row per connection per 10 minutes, same 423 each time", async () => {
    let clock = 0;
    const tools: string[] = [];
    const POST = createVitronicUploadHandler(
      uploadDeps({
        vaultOpen: () => false,
        mayAuditSkip: createSkipThrottle({ now: () => clock }),
        appendAudit: async (input) => {
          tools.push(input.tool);
        },
      }),
    );
    const answers: [number, unknown][] = [];
    for (const step of [0, 1_000, 599_999, 600_000, 600_001]) {
      clock = step;
      const res = await lockedPost(POST, CONNECTION_ID);
      answers.push([res.status, await res.json()]);
    }
    const locked = [423, { error: "Your data is locked. Unlock it to continue." }];
    expect(answers).toEqual([locked, locked, locked, locked, locked]);
    expect(tools).toEqual([
      "vault.locked.skip.bodyloop-upload",
      "vault.locked.skip.bodyloop-upload",
    ]);
  });

  test("an unknown connection id gets 401 and writes no row", async () => {
    const tools: string[] = [];
    let asked = 0;
    const POST = createVitronicUploadHandler(
      uploadDeps({
        vaultOpen: () => false,
        mayAuditSkip: () => {
          asked += 1;
          return true;
        },
        appendAudit: async (input) => {
          tools.push(input.tool);
        },
      }),
    );
    const res = await lockedPost(POST, OTHER_CONNECTION_ID);
    expect([res.status, tools, asked]).toEqual([401, [], 0]);
  });
});
