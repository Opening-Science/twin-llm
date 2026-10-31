import { formatTimestamp } from "@/infrastructure/format-measure";
import {
  ANCHOR_CHAIN_WORDS,
  type AnchorVerdict,
  anchorSentence,
} from "@/packages/audit/anchor";
import type { ChainName } from "@/packages/audit/chain";

import { type CheckStatus, type Evidence, type LabCheck } from "./lab-check";

/**
 * Adds the signed anchor (#300) to the Audit chain and the disclosure ledger
 * cards: the latest anchor, whether it holds, the key, and one sentence. The
 * card's status is the worse of the chain and the anchor: Not OK over
 * Unknown over OK, so a check that cannot run never reads as OK.
 */

export type AnchorView = Readonly<{
  verdict: AnchorVerdict;
  /** The current public key (SPKI, base64), or null without a key. */
  publicKey: string | null;
}>;

const RANK: Readonly<Record<CheckStatus, number>> = { ok: 0, unknown: 1, "not-ok": 2 };

export const worseStatus = (a: CheckStatus, b: CheckStatus): CheckStatus =>
  RANK[a] >= RANK[b] ? a : b;

type ResultKey = "ok" | Exclude<AnchorVerdict, { status: "ok" }>["reason"];

const RESULT: Readonly<Record<ResultKey, string>> = {
  ok: "signature OK, chain matches",
  "no-key": "off: no anchor key",
  "key-unreadable": "key could not be read",
  "log-unreadable": "file could not be read",
  "log-missing": "anchors file missing",
  "key-mismatch": "key does not match the file",
  "chain-unreadable": "chain could not be read",
  "no-anchor": "no anchor yet",
  truncated: "chain shorter than the anchor",
  removed: "anchored row missing",
  rewritten: "hash differs from the anchor",
  "continuity-break": "key replaced without the old key",
  unreadable: "a line is damaged",
  "bad-link": "a line was removed or changed",
  "bad-signature": "a signature does not hold",
  "unknown-key": "signed by an unknown key",
  "no-key-line": "the first key line is missing",
  "second-key-line": "a second first-key line",
};

export const anchorEvidence = (view: AnchorView | null): readonly Evidence[] => {
  if (view === null) {
    return [{ label: "Signed anchor", value: "could not be read" }];
  }
  const { verdict, publicKey } = view;
  const anchor = verdict.anchor;
  return [
    {
      label: "Latest signed anchor",
      value:
        anchor === null
          ? "none"
          : `row ${anchor.seq}, ${formatTimestamp(new Date(anchor.at))}`,
    },
    {
      label: "Anchor check",
      value: RESULT[verdict.status === "ok" ? "ok" : verdict.reason],
    },
    {
      label: "Anchor key id",
      value: verdict.keyId === null ? "none" : verdict.keyId.slice(0, 16),
      mono: verdict.keyId !== null,
    },
    ...(publicKey === null
      ? []
      : [{ label: "Anchor public key", value: publicKey, mono: true }]),
  ];
};

/** The chain's card with the anchor folded in. */
export const withAnchor = (
  check: LabCheck,
  view: AnchorView | null,
  chain: ChainName,
): LabCheck => {
  const status: CheckStatus =
    view === null ? "unknown" : view.verdict.status === "ok" ? "ok" : view.verdict.status;
  const sentence =
    view === null
      ? "The signed anchor could not be read just now."
      : anchorSentence(view.verdict, ANCHOR_CHAIN_WORDS[chain]);
  return {
    ...check,
    status: worseStatus(check.status, status),
    summary: `${check.summary} ${sentence}`,
    evidence: [...check.evidence, ...anchorEvidence(view)],
  };
};
