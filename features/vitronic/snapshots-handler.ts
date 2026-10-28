import { NextResponse } from "next/server";

/**
 * Vitronic subject snapshots GET, as a factory, so the Next route file can
 * export only GET and tests can pass fakes without replacing modules for the
 * whole bun process. The reader writes the audit row
 * (`vitronic.snapshots.list`) under the signed-in actor.
 */
type SnapshotsRouteContext = { params: Promise<unknown> };

export type VitronicSnapshotsDeps = {
  readonly vitronicEnv: () => unknown;
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly listSnapshotsForSubject: (
    userId: string,
    subjectId: string,
    opts: { readonly actor: string },
  ) => Promise<readonly unknown[]>;
};

export const createVitronicSnapshotsHandler = (deps: VitronicSnapshotsDeps) => {
  return async (_request: Request, context: SnapshotsRouteContext) => {
    if (!deps.vitronicEnv()) {
      return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
    }
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json(
        { error: "Sign in to list BodyLoop snapshots." },
        { status: 401 },
      );
    }
    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({ error: "User record missing." }, { status: 400 });
    }
    const { subjectId } = (await context.params) as { subjectId: string };
    try {
      const snapshots = await deps.listSnapshotsForSubject(appUserId, subjectId, {
        actor: clerkId,
      });
      return NextResponse.json({ snapshots });
    } catch (error) {
      console.error(
        "[vitronic] snapshots failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        { error: "Could not list BodyLoop snapshots." },
        { status: 502 },
      );
    }
  };
};
