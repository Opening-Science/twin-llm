import { NextResponse } from "next/server";

import { SKELETON_NOT_CONFIGURED_API, SKELETON_NOT_PINNED_API } from "./anatomy-copy";
import { servePinnedGlb } from "./pinned-glb-handler";

/**
 * GET /api/anatomy/skeleton: the open-anatomy skeleton GLB named by
 * ANATOMY_SKELETON_GLB. Public CC BY CT data, not personal data, so no auth
 * or audit, like the atlases. It is pinned like them: the ETag is
 * ANATOMY_SKELETON_SHA256, and a file with any other hash is not served.
 */
export type SkeletonDeps = Readonly<{
  /** The configured pin; null when no skeleton is configured. */
  skeletonSha256: () => string | null;
  /** The GLB's bytes only when they hash to the pin; null otherwise. */
  openSkeleton: () => Promise<Uint8Array<ArrayBuffer> | null>;
}>;

export const createSkeletonHandler = (deps: SkeletonDeps) => {
  return async (request: Request) => {
    const sha256 = deps.skeletonSha256();
    if (sha256 === null) {
      return NextResponse.json(
        { error: SKELETON_NOT_CONFIGURED_API, installed: false },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    // The viewer's URL carries no `?v=` for a local build, so it always revalidates.
    return servePinnedGlb(request, {
      sha256,
      version: null,
      open: deps.openSkeleton,
      notInstalled: SKELETON_NOT_PINNED_API,
    });
  };
};
