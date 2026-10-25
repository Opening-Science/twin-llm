import { NextResponse } from "next/server";

/**
 * Vitronic subject scans GET, as a factory, so the Next route file can export
 * only GET and tests can pass fakes without replacing modules for the whole
 * bun process.
 */
type ScansRouteContext = { params: Promise<unknown> };

export type VitronicScansDeps = {
  readonly vitronicEnv: () => unknown;
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly listScansForSubject: (params: {
    readonly userId: string;
    readonly actor: string;
    readonly subjectId: string;
  }) => Promise<readonly unknown[]>;
};

export const createVitronicScansHandler = (deps: VitronicScansDeps) => {
  return async (_request: Request, context: ScansRouteContext) => {
    if (!deps.vitronicEnv()) {
      return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
    }
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json(
        { error: "Sign in to list BodyLoop scans." },
        { status: 401 },
      );
    }
    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({ error: "User record missing." }, { status: 400 });
    }
    const { subjectId } = (await context.params) as { subjectId: string };
    try {
      const scans = await deps.listScansForSubject({
        userId: appUserId,
        actor: clerkId,
        subjectId,
      });
      return NextResponse.json({ scans });
    } catch (error) {
      console.error(
        "[vitronic] scans failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        { error: "Could not list BodyLoop scans." },
        { status: 502 },
      );
    }
  };
};
