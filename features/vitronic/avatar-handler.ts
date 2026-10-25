import { NextResponse } from "next/server";

/**
 * Vitronic avatar GET, as a factory, so the Next route file can export only
 * GET and tests can pass fakes without replacing modules for the whole bun
 * process.
 */
type AvatarRouteContext = { params: Promise<unknown> };

export type VitronicAvatarDeps = {
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly loadAvatarForSnapshot: (
    userId: string,
    snapshotId: string,
    actor: string,
  ) => Promise<Uint8Array | null>;
};

export const createVitronicAvatarHandler = (deps: VitronicAvatarDeps) => {
  return async (_request: Request, context: AvatarRouteContext) => {
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json(
        { error: "Sign in to load the BodyLoop scan." },
        { status: 401 },
      );
    }

    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    const { snapshotId } = (await context.params) as { snapshotId: string };
    const bytes = await deps.loadAvatarForSnapshot(appUserId, snapshotId, clerkId);
    if (!bytes) {
      return NextResponse.json({ error: "Not found." }, { status: 404 });
    }

    return new NextResponse(Buffer.from(bytes), {
      status: 200,
      headers: {
        "Content-Type": "model/gltf-binary",
        "Cache-Control": "private, no-store",
      },
    });
  };
};
