import { describe, expect, test } from "bun:test";

import { MAX_GLB_BYTES } from "@/packages/vitronic/glb";
import { CLOUD_CONNECT_SHAPE_PENDING } from "@/packages/vitronic/push";

import { createVitronicUploadHandler, type VitronicUploadDeps } from "./upload-handler";

const CONNECTION_ID = "conn-synthetic-1";
const OTHER_CONNECTION_ID = "conn-synthetic-other";
const KEY_EXTERNAL = "twin-synthetic-1";
const SECRET = "upload-secret-synthetic";

const uploadDeps = (): VitronicUploadDeps => ({
  vitronicEnv: () => ({ encryptionKey: "synthetic", dataDir: null }),
  findConnectionForUpload: async (connectionId: string) => {
    if (connectionId !== CONNECTION_ID) return null;
    return { id: CONNECTION_ID, uploadSecretEnc: "enc" };
  },
  decryptVitronicSecret: () => SECRET,
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
});
