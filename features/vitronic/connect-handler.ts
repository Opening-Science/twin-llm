import { NextResponse } from "next/server";
import { z } from "zod";

import { ScannerUrlRejectedError } from "@/packages/vitronic/base-url";
import { TlsPinMismatchError } from "@/packages/vitronic/tls";

import { type VitronicConnectInput } from "./connection";

/**
 * Vitronic connect POST, as a factory, so the Next route file can export only POST
 * and tests can pass fakes without replacing modules for the whole bun process.
 * The scanner URL is checked by persistVitronicConnection before any network
 * contact; a refused URL is a 400 with a plain sentence.
 */
const bodySchema = z.object({
  baseUrl: z.string().url(),
  apiToken: z.string().min(1),
  probandId: z.coerce.number().int().positive(),
  uploadSecret: z.string().min(1),
  apiTokenName: z.string().min(1).optional(),
});

export type VitronicConnectDeps = {
  readonly vitronicEnv: () => unknown;
  readonly resolveActorId: () => Promise<string | null>;
  readonly ensureAppUser: (clerkId: string) => Promise<{ readonly id: string }>;
  readonly persistVitronicConnection: (params: {
    readonly userId: string;
    readonly input: VitronicConnectInput;
  }) => Promise<unknown>;
};

export const createVitronicConnectHandler = (deps: VitronicConnectDeps) => {
  return async (request: Request) => {
    if (!deps.vitronicEnv()) {
      return NextResponse.json({ error: "BodyLoop is not configured." }, { status: 503 });
    }
    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json(
        { error: "Sign in to connect BodyLoop." },
        { status: 401 },
      );
    }
    const parsed = bodySchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "BodyLoop connection fields were incomplete." },
        { status: 400 },
      );
    }

    const user = await deps.ensureAppUser(clerkId);
    try {
      await deps.persistVitronicConnection({ userId: user.id, input: parsed.data });
    } catch (error) {
      if (error instanceof ScannerUrlRejectedError) {
        return NextResponse.json(
          {
            error:
              "Use the scanner's https address only, such as https://192.168.1.20, with no path or sign-in details.",
          },
          { status: 400 },
        );
      }
      if (error instanceof TlsPinMismatchError) {
        return NextResponse.json(
          { error: "BodyLoop TLS pin did not match." },
          { status: 502 },
        );
      }
      console.error(
        "[vitronic] connect failed",
        error instanceof Error ? error.name : "unknown",
      );
      return NextResponse.json(
        {
          error:
            "Could not store BodyLoop connection. Check the scanner URL and certificate.",
        },
        { status: 502 },
      );
    }
    return NextResponse.json({ ok: true, connected: true });
  };
};
