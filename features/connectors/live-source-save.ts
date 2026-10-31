import { type LiveSourceId, normaliseLiveSources } from "@/infrastructure/live-sources";
import {
  LIVE_SOURCE_LOCAL_ONLY,
  LOCAL_ONLY_SENTENCE,
} from "@/packages/live-sources/refusals";

/**
 * What a change to the live source switches (#6) may store. Pure, so the
 * Connectors action and its test share it. In local-only mode no source may
 * be switched on; turning every one off is always allowed.
 */

export type LiveSourceSave =
  | Readonly<{ ok: true; enabled: readonly LiveSourceId[] }>
  | Readonly<{ ok: false; code: string; error: string }>;

export const decideLiveSourceSave = (
  raw: unknown,
  localOnly: boolean,
): LiveSourceSave => {
  const enabled = normaliseLiveSources(raw);
  if (localOnly && enabled.length > 0) {
    return { ok: false, code: LIVE_SOURCE_LOCAL_ONLY, error: LOCAL_ONLY_SENTENCE };
  }
  return { ok: true, enabled };
};

/** The audit row of a change: which sources are on now. No other content. */
export const liveSourceAuditEvent = (
  actor: string,
  enabled: readonly LiveSourceId[],
) => ({
  actor,
  sessionId: "live-sources",
  subjectRef: null,
  tool: "live.sources.set",
  args: { enabled: [...enabled] },
  result: { saved: true },
  rowCount: 0,
});
