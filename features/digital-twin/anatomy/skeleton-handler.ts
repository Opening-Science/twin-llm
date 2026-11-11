import { NextResponse } from "next/server";

import { SKELETON_NOT_CONFIGURED_API } from "./anatomy-copy";
import { matchesEtag } from "./pinned-glb-handler";

/**
 * GET /api/anatomy/skeleton: the open-anatomy skeleton GLB named by
 * ANATOMY_SKELETON_GLB. Public CC BY CT data, not personal data, so no auth
 * or audit, like the atlases. It is a local build rather than a pinned file,
 * so it always revalidates against its size-and-time ETag.
 */
export type SkeletonDeps = Readonly<{
  statSkeleton: () => Promise<Readonly<{ etag: string }> | null>;
  openSkeleton: () => Promise<Uint8Array<ArrayBuffer> | null>;
}>;

const REVALIDATE = "private, max-age=0, must-revalidate";

const notConfigured = () =>
  NextResponse.json(
    { error: SKELETON_NOT_CONFIGURED_API, installed: false },
    { status: 404, headers: { "Cache-Control": "no-store" } },
  );

export const createSkeletonHandler = (deps: SkeletonDeps) => {
  return async (request: Request) => {
    const info = await deps.statSkeleton();
    if (!info) return notConfigured();
    const headers = { ETag: info.etag, "Cache-Control": REVALIDATE };
    if (matchesEtag(request.headers.get("if-none-match"), info.etag)) {
      return new Response(null, { status: 304, headers });
    }
    const bytes = await deps.openSkeleton();
    if (!bytes) return notConfigured();
    return new Response(bytes, {
      status: 200,
      headers: {
        ...headers,
        "Content-Type": "model/gltf-binary",
        "Content-Length": String(bytes.byteLength),
        "X-Content-Type-Options": "nosniff",
      },
    });
  };
};
