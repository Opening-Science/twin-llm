import { INCOGNITO_SESSION_PREFIX } from "@/infrastructure/incognito";

import type { LiveSourceId } from "./constants";
import { QUERY_REFUSAL_SENTENCES, type QueryRefusalReason } from "./query-check";

/**
 * Coded refusals of the live tools. Each carries a code for the audit row and
 * the model, and one plain sentence a person can read. None carries a
 * provider's message or response body. Pure.
 */

export type LiveRefusal = Readonly<{
  ok: false;
  code: string;
  error: string;
  reason?: QueryRefusalReason;
}>;

export const LIVE_SOURCE_LOCAL_ONLY = "LIVE_SOURCE_LOCAL_ONLY" as const;
export const LIVE_SOURCE_INCOGNITO = "LIVE_SOURCE_INCOGNITO" as const;
export const LIVE_SOURCE_OFF = "LIVE_SOURCE_OFF" as const;
export const LIVE_SOURCE_NOT_RECORDED = "LIVE_SOURCE_NOT_RECORDED" as const;
export const LIVE_SOURCE_FAILED = "LIVE_SOURCE_FAILED" as const;
export const LIVE_QUERY_REFUSED = "LIVE_QUERY_REFUSED" as const;
export const LIVE_NOT_FOUND = "LIVE_NOT_FOUND" as const;

export const LOCAL_ONLY_SENTENCE =
  "Live lookups are off on this server because it runs in local-only mode, so nothing was sent.";

const refusal = (code: string, error: string): LiveRefusal => ({
  ok: false,
  code,
  error,
});

export const LIVE_REFUSALS = {
  localOnly: refusal(LIVE_SOURCE_LOCAL_ONLY, LOCAL_ONLY_SENTENCE),
  incognito: refusal(
    LIVE_SOURCE_INCOGNITO,
    "Live lookups are off in incognito chats, so nothing was sent.",
  ),
  off: refusal(
    LIVE_SOURCE_OFF,
    "This live source is switched off in Customize · Connectors, so nothing was sent.",
  ),
  notRecorded: refusal(
    LIVE_SOURCE_NOT_RECORDED,
    "The lookup could not be written to the disclosure ledger, so it was not sent.",
  ),
  failed: refusal(
    LIVE_SOURCE_FAILED,
    "The public database did not answer in time. Try again later.",
  ),
  notFound: refusal(LIVE_NOT_FOUND, "Ensembl has no human gene or variant by that name."),
  badKey: refusal(
    LIVE_QUERY_REFUSED,
    "Give one gene symbol or one rsID, not both and not neither, so nothing was sent.",
  ),
} as const;

export const queryRefusal = (reason: QueryRefusalReason): LiveRefusal => ({
  ok: false,
  code: LIVE_QUERY_REFUSED,
  reason,
  error: QUERY_REFUSAL_SENTENCES[reason],
});

/** What one chat turn allows: the person's switches and how the turn runs. */
export type LiveTurn = Readonly<{
  /** The live sources this person switched on. */
  enabled: readonly LiveSourceId[];
  /** An incognito chat: nothing may leave. */
  incognito: boolean;
  /** The person's genome is part of this turn: no rsID is sent. */
  genomeInTurn: boolean;
}>;

/**
 * May this turn send a lookup to `source`? Local-only mode first (the whole
 * server sends nothing), then incognito (an incognito session id counts even
 * when the caller forgot to say so), then the person's switch.
 */
export const permitLiveLookup = (
  input: Readonly<{
    localOnly: boolean;
    turn: LiveTurn;
    sessionId: string;
    source: LiveSourceId;
  }>,
): LiveRefusal | null => {
  if (input.localOnly) return LIVE_REFUSALS.localOnly;
  if (input.turn.incognito || input.sessionId.startsWith(INCOGNITO_SESSION_PREFIX)) {
    return LIVE_REFUSALS.incognito;
  }
  if (!input.turn.enabled.includes(input.source)) return LIVE_REFUSALS.off;
  return null;
};
