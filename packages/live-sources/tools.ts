import type { PrismaClient } from "@/generated/prisma/client";
import type { RecordDisclosure } from "@/infrastructure/disclosure-ledger";
import type { AppendInput } from "@/packages/audit/append";
import type { SessionScope } from "@/packages/query-tools/scope";

import type { TtlCache } from "./cache";
import { ENSEMBL_AUDIT_TOOL, PUBMED_AUDIT_TOOL, PUBMED_MAX_LIMIT } from "./constants";
import { isAllowedUrl, type LiveRequest, liveLookupDisclosure } from "./disclosure";
import {
  ensemblCitation,
  type EnsemblGene,
  type EnsemblVariant,
  geneLookupUrl,
  parseGene,
  parseVariant,
  variantLookupUrl,
} from "./ensembl";
import type { LiveFetch, LiveResponse } from "./fetch";
import { type EnsemblLookupInput, lookupKeyOf, type PubmedSearchInput } from "./input";
import {
  efetchUrl,
  esearchUrl,
  esummaryUrl,
  type EutilsIdentity,
  type LiveCitation,
  parseAbstracts,
  parseEsearchPmids,
  parseEsummary,
  type PubmedArticle,
  pubmedCitation,
} from "./pubmed";
import { checkLookupKey, checkSearchTerms, type QueryTerms } from "./query-check";
import {
  LIVE_REFUSALS,
  type LiveRefusal,
  type LiveTurn,
  permitLiveLookup,
  queryRefusal,
} from "./refusals";

/**
 * The two live tools. Every lookup, in this order:
 *
 * 1. Refused in local-only mode, in an incognito chat and when the person has
 *    not switched the source on (`permitLiveLookup`).
 * 2. Its terms, taken only from the model's arguments, pass `query-check.ts`.
 * 3. A cached answer (same person, same terms, within a day) is returned and
 *    nothing is sent.
 * 4. Each HTTP request is written to the disclosure ledger before it is sent
 *    (`liveLookupDisclosure`); when that write fails, nothing more is sent and
 *    the tool returns `LIVE_SOURCE_NOT_RECORDED`.
 * 5. The call is audited: the arguments, the outcome code, the kinds of term
 *    the query held (counts, never the terms) and the ids returned.
 *
 * A failure reaches the model as a code and a plain sentence; the service's
 * message or body never does.
 */

export type LiveToolPorts = Readonly<{
  localOnly: () => boolean;
  identity: () => EutilsIdentity;
  fetch: LiveFetch;
  recordDisclosure: RecordDisclosure;
  append: (client: PrismaClient, input: AppendInput) => Promise<unknown>;
  database: () => PrismaClient;
  cache: TtlCache<LiveAnswer>;
}>;

export type PubmedAnswer = Readonly<{
  ok: true;
  source: "PubMed";
  articles: readonly PubmedArticle[];
  citations: readonly LiveCitation[];
  note: string;
}>;

export type EnsemblAnswer = Readonly<{
  ok: true;
  source: "Ensembl";
  fact: EnsemblGene | EnsemblVariant;
  citations: readonly LiveCitation[];
  note: string;
}>;

export type LiveAnswer = PubmedAnswer | EnsemblAnswer;

export const PUBMED_NOTE =
  "Live PubMed search results. Cite each article you use by its PMID and URL. Published literature, not a statement about this person.";
export const ENSEMBL_NOTE =
  "Live Ensembl reference facts. Cite the Ensembl URL. Not a statement about this person.";

class NotRecorded extends Error {
  constructor() {
    super("not recorded");
    this.name = "NotRecorded";
  }
}

/** Records one request in the ledger, then sends it; a failed record sends nothing. */
const sendRecorded =
  (scope: SessionScope, ports: LiveToolPorts) =>
  async (request: LiveRequest): Promise<LiveResponse> => {
    if (!isAllowedUrl(request.url)) throw new Error("LIVE_ORIGIN_NOT_ALLOWED");
    try {
      await ports.recordDisclosure(liveLookupDisclosure(scope, request));
    } catch {
      throw new NotRecorded();
    }
    return ports.fetch(request);
  };

type Outcome<A extends LiveAnswer> = Readonly<{
  answer: A | LiveRefusal;
  terms: QueryTerms | null;
  cached: boolean;
  ids: readonly string[];
}>;

const audit = async (
  scope: SessionScope,
  ports: LiveToolPorts,
  tool: string,
  args: unknown,
  outcome: Outcome<LiveAnswer>,
): Promise<void> => {
  await ports.append(ports.database(), {
    actor: scope.actor,
    sessionId: scope.sessionId,
    subjectRef: null,
    tool,
    args,
    result: outcome.answer.ok
      ? { ids: outcome.ids, terms: outcome.terms, cached: outcome.cached }
      : {
          code: outcome.answer.code,
          ...(outcome.answer.reason === undefined
            ? {}
            : { reason: outcome.answer.reason }),
          terms: outcome.terms,
        },
    rowCount: outcome.answer.ok ? outcome.ids.length : 0,
  });
};

const failureOf = (error: unknown): LiveRefusal =>
  error instanceof NotRecorded ? LIVE_REFUSALS.notRecorded : LIVE_REFUSALS.failed;

const okBody = (response: LiveResponse): string => {
  if (response.status < 200 || response.status > 299) {
    throw new Error("LIVE_HTTP_STATUS");
  }
  return response.body;
};

const searchPubmed = async (
  scope: SessionScope,
  query: string,
  limit: number,
  ports: LiveToolPorts,
): Promise<PubmedAnswer> => {
  const send = sendRecorded(scope, ports);
  const identity = ports.identity();
  const pmids = parseEsearchPmids(
    okBody(
      await send({
        source: "pubmed",
        step: "esearch",
        url: esearchUrl(query, limit, identity),
        carries: "search terms",
      }),
    ),
  ).slice(0, limit);
  if (pmids.length === 0) {
    return { ok: true, source: "PubMed", articles: [], citations: [], note: PUBMED_NOTE };
  }
  const summaries = parseEsummary(
    okBody(
      await send({
        source: "pubmed",
        step: "esummary",
        url: esummaryUrl(pmids, identity),
        carries: "public record ids",
      }),
    ),
    pmids,
  );
  const abstracts = await send({
    source: "pubmed",
    step: "efetch",
    url: efetchUrl(pmids, identity),
    carries: "public record ids",
  }).then(
    (response) => parseAbstracts(okBody(response)),
    (error: unknown) => {
      // Abstracts are optional; a ledger failure still stops the lookup.
      if (error instanceof NotRecorded) throw error;
      return new Map<string, string>();
    },
  );
  const articles = summaries.map((summary) => ({
    ...summary,
    abstractSnippet: abstracts.get(summary.pmid) ?? null,
  }));
  return {
    ok: true,
    source: "PubMed",
    articles,
    citations: articles.map(pubmedCitation),
    note: PUBMED_NOTE,
  };
};

export const runPubmedSearch = async (
  scope: SessionScope,
  input: PubmedSearchInput,
  turn: LiveTurn,
  ports: LiveToolPorts,
): Promise<PubmedAnswer | LiveRefusal> => {
  const outcome = await (async (): Promise<Outcome<PubmedAnswer>> => {
    const refused = permitLiveLookup({
      localOnly: ports.localOnly(),
      turn,
      sessionId: scope.sessionId,
      source: "pubmed",
    });
    if (refused !== null) return { answer: refused, terms: null, cached: false, ids: [] };
    const check = checkSearchTerms(input.query, { genomeInTurn: turn.genomeInTurn });
    if (!check.ok) {
      return { answer: queryRefusal(check.reason), terms: null, cached: false, ids: [] };
    }
    const query = input.query.trim().replace(/\s+/g, " ");
    const limit = Math.min(Math.max(Math.trunc(input.limit), 1), PUBMED_MAX_LIMIT);
    const key = `pubmed|${scope.actor}|${query.toLowerCase()}|${String(limit)}`;
    const hit = ports.cache.get(key);
    if (hit?.source === "PubMed") {
      return {
        answer: hit,
        terms: check.terms,
        cached: true,
        ids: hit.articles.map((a) => a.pmid),
      };
    }
    try {
      const answer = await searchPubmed(scope, query, limit, ports);
      ports.cache.set(key, answer);
      return {
        answer,
        terms: check.terms,
        cached: false,
        ids: answer.articles.map((a) => a.pmid),
      };
    } catch (error) {
      return { answer: failureOf(error), terms: check.terms, cached: false, ids: [] };
    }
  })();
  await audit(scope, ports, PUBMED_AUDIT_TOOL, input, outcome);
  return outcome.answer;
};

export const runEnsemblLookup = async (
  scope: SessionScope,
  input: EnsemblLookupInput,
  turn: LiveTurn,
  ports: LiveToolPorts,
): Promise<EnsemblAnswer | LiveRefusal> => {
  const outcome = await (async (): Promise<Outcome<EnsemblAnswer>> => {
    const refused = permitLiveLookup({
      localOnly: ports.localOnly(),
      turn,
      sessionId: scope.sessionId,
      source: "ensembl",
    });
    if (refused !== null) return { answer: refused, terms: null, cached: false, ids: [] };
    const lookupKey = lookupKeyOf(input);
    if (lookupKey === null) {
      return { answer: LIVE_REFUSALS.badKey, terms: null, cached: false, ids: [] };
    }
    const check = checkLookupKey(lookupKey, { genomeInTurn: turn.genomeInTurn });
    if (!check.ok) {
      return { answer: queryRefusal(check.reason), terms: null, cached: false, ids: [] };
    }
    const isGene = "symbol" in lookupKey;
    const term = isGene ? lookupKey.symbol : lookupKey.rsid;
    const key = `ensembl|${scope.actor}|${term}`;
    const hit = ports.cache.get(key);
    if (hit?.source === "Ensembl") {
      return {
        answer: hit,
        terms: check.terms,
        cached: true,
        ids: [hit.citations[0]?.id ?? term],
      };
    }
    try {
      const response = await sendRecorded(
        scope,
        ports,
      )({
        source: "ensembl",
        step: isGene ? "gene" : "variant",
        url: isGene ? geneLookupUrl(term) : variantLookupUrl(term),
        carries: "search terms",
      });
      if (response.status === 400 || response.status === 404) {
        return {
          answer: LIVE_REFUSALS.notFound,
          terms: check.terms,
          cached: false,
          ids: [],
        };
      }
      const body = okBody(response);
      const fact = isGene ? parseGene(body) : parseVariant(body);
      const citation = ensemblCitation(fact);
      const answer: EnsemblAnswer = {
        ok: true,
        source: "Ensembl",
        fact,
        citations: [citation],
        note: ENSEMBL_NOTE,
      };
      ports.cache.set(key, answer);
      return { answer, terms: check.terms, cached: false, ids: [citation.id] };
    } catch (error) {
      return { answer: failureOf(error), terms: check.terms, cached: false, ids: [] };
    }
  })();
  await audit(scope, ports, ENSEMBL_AUDIT_TOOL, input, outcome);
  return outcome.answer;
};
