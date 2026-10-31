import { NextResponse } from "next/server";

import type { RecordDisclosure } from "@/infrastructure/disclosure-ledger";
import type { PersonalRead } from "@/infrastructure/personal-read-audit";

import {
  auditThenSave,
  type PreparedSync,
  type SyncedProvider,
  vendorSyncDisclosure,
} from "./audited-sync";

/**
 * Wearable sync POST, as one factory for Oura, Whoop and Google Health. The
 * three routes only differed in copy and Oura's sandbox flag, so each route
 * file wires its provider here and tests pass fakes instead of replacing
 * modules.
 *
 * Each sync writes one `personal.read.sync-<provider>` row with the metric count
 * before its snapshot is stored (`auditThenSave`); when the row cannot be
 * written nothing is stored and the sync reports failed.
 *
 * The request to the vendor is written to the disclosure ledger first (#140);
 * when that write fails nothing is fetched and the sync reports failed.
 *
 * `logError` gets the error name, never the error: a provider message can
 * carry token or response-body text into the server log.
 */

export type WearableSyncProvider = SyncedProvider;

export type WearableSyncRequest = Readonly<{
  sandbox?: boolean;
  startDate?: string;
  endDate?: string;
}>;

export type WearableSyncDeps = {
  readonly provider: WearableSyncProvider;
  readonly isConfigured: () => boolean;
  readonly resolveActorId: () => Promise<string | null>;
  readonly findAppUserId: (clerkId: string) => Promise<string | null>;
  readonly sync: (
    userId: string,
    request: WearableSyncRequest,
  ) => Promise<
    PreparedSync<{ readonly metrics: readonly unknown[]; readonly window: unknown }>
  >;
  readonly auditPersonalRead: (read: PersonalRead) => Promise<unknown>;
  readonly recordDisclosure: RecordDisclosure;
  readonly logError: (message: string, errorName: string) => void;
};

type SyncCopy = Readonly<{
  unconfigured: string;
  signIn: string;
  failed: string;
}>;

const COPY: Readonly<Record<WearableSyncProvider, SyncCopy>> = {
  oura: {
    unconfigured: "Oura is not configured.",
    signIn: "Sign in to sync Oura.",
    failed: "Could not sync Oura data. Reconnect and try again.",
  },
  whoop: {
    unconfigured: "Whoop is not configured.",
    signIn: "Sign in to sync Whoop.",
    failed: "Could not sync Whoop data. Reconnect and try again.",
  },
  "google-health": {
    unconfigured: "Google Health is not configured.",
    signIn: "Sign in to sync Google Health.",
    failed:
      "Could not sync Google Health. Confirm Fitbit is linked to the Google account and API access is enabled, then reconnect.",
  },
};

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : "unknown";

export const createWearableSyncHandler = (deps: WearableSyncDeps) => {
  const copy = COPY[deps.provider];

  return async (request: Request) => {
    if (!deps.isConfigured()) {
      return NextResponse.json({ error: copy.unconfigured }, { status: 503 });
    }

    const clerkId = await deps.resolveActorId();
    if (!clerkId) {
      return NextResponse.json({ error: copy.signIn }, { status: 401 });
    }

    const appUserId = await deps.findAppUserId(clerkId);
    if (!appUserId) {
      return NextResponse.json({ error: "User record missing." }, { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const { sandbox, startDate, endDate } = body as WearableSyncRequest;

    try {
      const summary = await auditThenSave(
        () => deps.sync(appUserId, { sandbox, startDate, endDate }),
        deps.provider,
        clerkId,
        deps.auditPersonalRead,
        () =>
          deps.recordDisclosure(
            vendorSyncDisclosure(deps.provider, clerkId, { sandbox: sandbox === true }),
          ),
      );
      return NextResponse.json({
        ok: true,
        metricCount: summary.metrics.length,
        window: summary.window,
      });
    } catch (error) {
      deps.logError(`[${deps.provider}] sync failed`, errorName(error));
      return NextResponse.json({ error: copy.failed }, { status: 502 });
    }
  };
};
