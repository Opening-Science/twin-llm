import { describe, expect, test } from "bun:test";

import { buildTinyGlb } from "@/packages/vitronic/tiny-glb";

import { createVitronicAvatarHandler, type VitronicAvatarDeps } from "./avatar-handler";

const OWNER = "user-owner";
const OTHER = "user-other";
const SNAP_OWNER = "snap-owner";
const SNAP_OTHER = "snap-other";
const glb = buildTinyGlb();

let actor: string | null = OWNER;

const avatarDeps = (): VitronicAvatarDeps => ({
  resolveActorId: async () => actor,
  findAppUserId: async (clerkId: string) => {
    if (clerkId === OWNER) return OWNER;
    if (clerkId === OTHER) return OTHER;
    return null;
  },
  loadAvatarForSnapshot: async (userId: string, snapshotId: string) => {
    if (userId === OWNER && snapshotId === SNAP_OWNER) return glb;
    return null;
  },
});

const ctx = (snapshotId: string) => ({ params: Promise.resolve({ snapshotId }) });

describe("GET /api/vitronic/avatar/:snapshotId", () => {
  test("401 when anonymous", async () => {
    actor = null;
    const GET = createVitronicAvatarHandler(avatarDeps());
    const res = await GET(
      new Request("http://local/api/vitronic/avatar/x"),
      ctx(SNAP_OWNER),
    );
    expect(res.status).toBe(401);
  });

  test("200 model/gltf-binary for the owner snapshot", async () => {
    actor = OWNER;
    const GET = createVitronicAvatarHandler(avatarDeps());
    const res = await GET(
      new Request("http://local/api/vitronic/avatar/x"),
      ctx(SNAP_OWNER),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("model/gltf-binary");
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(bytes.byteLength).toBe(glb.byteLength);
  });

  test("404 when the actor has no blob", async () => {
    actor = OWNER;
    const GET = createVitronicAvatarHandler(avatarDeps());
    const res = await GET(
      new Request("http://local/api/vitronic/avatar/x"),
      ctx("missing"),
    );
    expect(res.status).toBe(404);
  });

  test("404 for another actor's snapshot", async () => {
    actor = OTHER;
    const GET = createVitronicAvatarHandler(avatarDeps());
    const res = await GET(
      new Request("http://local/api/vitronic/avatar/x"),
      ctx(SNAP_OWNER),
    );
    expect(res.status).toBe(404);
    actor = OWNER;
    const other = await GET(
      new Request("http://local/api/vitronic/avatar/x"),
      ctx(SNAP_OTHER),
    );
    expect(other.status).toBe(404);
  });
});
