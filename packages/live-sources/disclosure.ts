import {
  CATEGORY,
  type Disclosure,
  type DisclosureCategory,
} from "@/infrastructure/disclosure-ledger";
import type { SessionScope } from "@/packages/query-tools/scope";

import {
  ALLOWED_ORIGINS,
  ENSEMBL_RECIPIENT,
  type LiveSourceId,
  PUBMED_RECIPIENT,
} from "./constants";

/**
 * One HTTP request of a live lookup, and its disclosure ledger row (#140).
 * The row names the recipient, the step, the purpose and the kind of thing
 * the request carried, and its size; never the terms, and never a stored
 * value of the person (`refs` is always empty). Pure.
 */

export type LiveStep = "esearch" | "esummary" | "efetch" | "gene" | "variant";

export type LiveRequest = Readonly<{
  source: LiveSourceId;
  step: LiveStep;
  url: string;
  /** Search terms written by the model, or public record ids the service sent back. */
  carries: "search terms" | "public record ids";
}>;

const RECIPIENT: Readonly<Record<LiveSourceId, string>> = {
  pubmed: PUBMED_RECIPIENT,
  ensembl: ENSEMBL_RECIPIENT,
};

const PURPOSE: Readonly<Record<LiveSourceId, string>> = {
  pubmed: "literature search",
  ensembl: "gene and variant lookup",
};

const CATEGORIES: Readonly<Record<LiveRequest["carries"], DisclosureCategory>> = {
  "search terms": CATEGORY.searchTerms,
  "public record ids": CATEGORY.publicIds,
};

/** True for an https address on one of the allowlisted origins. */
export const isAllowedUrl = (url: string): boolean => {
  try {
    const parsed = new URL(url);
    return (
      parsed.protocol === "https:" &&
      parsed.username === "" &&
      parsed.password === "" &&
      ALLOWED_ORIGINS.includes(parsed.origin)
    );
  } catch {
    return false;
  }
};

/** The size of a GET request's address, which is where its terms travel. */
const urlBytes = (url: string): number => new TextEncoder().encode(url).length;

export const liveLookupDisclosure = (
  scope: SessionScope,
  request: LiveRequest,
): Disclosure => ({
  actor: scope.actor,
  sessionId: scope.sessionId,
  kind: "public-lookup",
  recipient: RECIPIENT[request.source],
  target: request.step,
  purpose: PURPOSE[request.source],
  categories: [CATEGORIES[request.carries]],
  refs: [],
  payloadBytes: urlBytes(request.url),
  threadId: null,
  synthetic: scope.mode === "synthetic",
});
