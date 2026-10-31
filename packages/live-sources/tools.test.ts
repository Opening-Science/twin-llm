import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  createRecordDisclosure,
  type Disclosure,
} from "@/infrastructure/disclosure-ledger";
import type { AppendInput } from "@/packages/audit/append";

import { createTtlCache } from "./cache";
import type { LiveRequest } from "./disclosure";
import type { LiveResponse } from "./fetch";
import { type LiveAnswer, runEnsemblLookup, runPubmedSearch } from "./tools";

/**
 * The live tools end to end over recorded NCBI and Ensembl responses
 * (`fixtures/`, recorded 2026-10-31): no network. Each test checks what was
 * written to the ledger, what was sent and in which order.
 */

const fixture = (name: string): string =>
  readFileSync(join(import.meta.dir, "fixtures", name), "utf8");

const RECORDED: Readonly<Record<string, string>> = {
  esearch: fixture("pubmed-esearch.json"),
  esummary: fixture("pubmed-esummary.json"),
  efetch: fixture("pubmed-efetch.xml"),
  gene: fixture("ensembl-gene-KCNH2.json"),
  variant: fixture("ensembl-variant-rs429358.json"),
};

const scope = { actor: "local", sessionId: "turn-1", mode: "synthetic" } as const;
const turn = {
  enabled: ["pubmed", "ensembl"] as const,
  incognito: false,
  genomeInTurn: false,
};

const harness = (
  options: Readonly<{
    ledgerFails?: boolean;
    localOnly?: boolean;
    status?: number;
    failStep?: string;
  }> = {},
) => {
  const events: string[] = [];
  const ledger: Disclosure[] = [];
  const audits: AppendInput[] = [];
  const sent: LiveRequest[] = [];
  const ports = {
    localOnly: () => options.localOnly ?? false,
    identity: () => ({ tool: "twinllm", email: null }),
    fetch: async (request: LiveRequest): Promise<LiveResponse> => {
      events.push(`send ${request.step}`);
      sent.push(request);
      if (options.failStep === request.step) throw new Error("socket said: secret body");
      return { status: options.status ?? 200, body: RECORDED[request.step] ?? "" };
    },
    recordDisclosure: createRecordDisclosure(async (disclosure) => {
      if (options.ledgerFails) throw new Error("database down");
      events.push(`ledger ${disclosure.target ?? ""}`);
      ledger.push(disclosure);
      return { seq: 1n, auditSeq: 1n };
    }),
    append: async (_client: PrismaClient, input: AppendInput) => {
      audits.push(input);
    },
    database: () => ({}) as PrismaClient,
    cache: createTtlCache<LiveAnswer>({ ttlMs: 60_000, maxEntries: 10, now: () => 0 }),
  };
  return { ports, events, ledger, audits, sent };
};

const QUERY = { query: "atrial fibrillation heart rate variability", limit: 3 };

describe("pubmed_search", () => {
  test("records each request before sending it and returns citations", async () => {
    const { ports, events, ledger, audits } = harness();
    const answer = await runPubmedSearch(scope, QUERY, turn, ports);
    expect(events).toEqual([
      "ledger esearch",
      "send esearch",
      "ledger esummary",
      "send esummary",
      "ledger efetch",
      "send efetch",
    ]);
    expect(
      ledger.map((row) => [row.kind, row.recipient, row.categories, row.refs]),
    ).toEqual([
      ["public-lookup", "NCBI PubMed", ["search terms"], []],
      ["public-lookup", "NCBI PubMed", ["public record ids"], []],
      ["public-lookup", "NCBI PubMed", ["public record ids"], []],
    ]);
    expect(answer.ok && answer.source === "PubMed" ? answer.citations : null).toEqual([
      {
        source: "PubMed",
        id: "PMID:31560809",
        title:
          "Heart rate variability in atrial fibrillation: The balance between sympathetic and parasympathetic nervous system.",
        url: "https://pubmed.ncbi.nlm.nih.gov/31560809/",
      },
      {
        source: "PubMed",
        id: "PMID:9727672",
        title: "Heart rate variability preceding onset of atrial fibrillation.",
        url: "https://pubmed.ncbi.nlm.nih.gov/9727672/",
      },
      {
        source: "PubMed",
        id: "PMID:40079735",
        title:
          "Heart rate variability in patients with atrial fibrillation of sinus rhythm or atrial fibrillation: chaos or merit?",
        url: "https://pubmed.ncbi.nlm.nih.gov/40079735/",
      },
    ]);
    expect(audits).toEqual([
      {
        actor: "local",
        sessionId: "turn-1",
        subjectRef: null,
        tool: "live.pubmed_search",
        args: QUERY,
        result: {
          ids: ["31560809", "9727672", "40079735"],
          terms: { words: 5, geneSymbols: 0, rsids: 0 },
          cached: false,
        },
        rowCount: 3,
      },
    ]);
  });

  test("a failed ledger write sends nothing", async () => {
    const { ports, sent, audits } = harness({ ledgerFails: true });
    expect(await runPubmedSearch(scope, QUERY, turn, ports)).toEqual({
      ok: false,
      code: "LIVE_SOURCE_NOT_RECORDED",
      error:
        "The lookup could not be written to the disclosure ledger, so it was not sent.",
    });
    expect(sent).toEqual([]);
    expect(audits.map((row) => [row.result, row.rowCount])).toEqual([
      [
        {
          code: "LIVE_SOURCE_NOT_RECORDED",
          terms: { words: 5, geneSymbols: 0, rsids: 0 },
        },
        0,
      ],
    ]);
  });

  test("local-only mode, incognito and a switched-off source send and record nothing", async () => {
    const cases = [
      { options: { localOnly: true }, turn, code: "LIVE_SOURCE_LOCAL_ONLY" },
      { options: {}, turn: { ...turn, incognito: true }, code: "LIVE_SOURCE_INCOGNITO" },
      {
        options: {},
        turn: { ...turn, enabled: ["ensembl"] as const },
        code: "LIVE_SOURCE_OFF",
      },
    ];
    for (const item of cases) {
      const { ports, events } = harness(item.options);
      const answer = await runPubmedSearch(scope, QUERY, item.turn, ports);
      expect([answer.ok ? null : answer.code, events]).toEqual([item.code, []]);
    }
  });

  test("a query with a value in it is refused before the ledger", async () => {
    const { ports, events, audits } = harness();
    const answer = await runPubmedSearch(
      scope,
      { query: "resting heart rate 58 trend", limit: 3 },
      turn,
      ports,
    );
    expect(answer).toEqual({
      ok: false,
      code: "LIVE_QUERY_REFUSED",
      reason: "number",
      error:
        "Search terms may not contain numbers other than in gene symbols, rsIDs and a short list of public topic names such as type 2 diabetes, so nothing was sent. Write the topic in words.",
    });
    expect(events).toEqual([]);
    expect(audits[0]?.result).toEqual({
      code: "LIVE_QUERY_REFUSED",
      reason: "number",
      terms: null,
    });
  });

  test("the same search again comes from the cache and sends nothing", async () => {
    const { ports, events, audits } = harness();
    await runPubmedSearch(scope, QUERY, turn, ports);
    const before = events.length;
    const again = await runPubmedSearch(
      scope,
      { ...QUERY, query: "  Atrial fibrillation   heart rate variability" },
      turn,
      ports,
    );
    expect([again.ok, events.length - before]).toEqual([true, 0]);
    expect(audits.map((row) => (row.result as { cached: boolean }).cached)).toEqual([
      false,
      true,
    ]);
  });

  test("a service failure is a code and a sentence, never its message", async () => {
    const { ports } = harness({ failStep: "esummary" });
    expect(await runPubmedSearch(scope, QUERY, turn, ports)).toEqual({
      ok: false,
      code: "LIVE_SOURCE_FAILED",
      error: "The public database did not answer in time. Try again later.",
    });
  });

  test("a missing abstract leaves the snippet out but keeps the article", async () => {
    const { ports } = harness({ failStep: "efetch" });
    const answer = await runPubmedSearch(scope, QUERY, turn, ports);
    expect(
      answer.ok && answer.source === "PubMed"
        ? answer.articles.map((article) => [article.pmid, article.abstractSnippet])
        : null,
    ).toEqual([
      ["31560809", null],
      ["9727672", null],
      ["40079735", null],
    ]);
  });
});

describe("ensembl_lookup", () => {
  test("a gene by symbol, recorded first, with its source address", async () => {
    const { ports, events, ledger } = harness();
    const answer = await runEnsemblLookup(scope, { symbol: "kcnh2" }, turn, ports);
    expect(events).toEqual(["ledger gene", "send gene"]);
    expect(ledger[0]?.payloadBytes).toBe(87);
    expect(answer.ok && answer.source === "Ensembl" ? answer.citations : null).toEqual([
      {
        source: "Ensembl",
        id: "ENSG00000055118",
        title: "KCNH2 gene (Ensembl ENSG00000055118)",
        url: "https://www.ensembl.org/Homo_sapiens/Gene/Summary?g=ENSG00000055118",
      },
    ]);
  });

  test("a variant by rsID", async () => {
    const { ports, sent } = harness();
    const answer = await runEnsemblLookup(scope, { rsid: "rs429358" }, turn, ports);
    expect(sent.map((request) => request.url)).toEqual([
      "https://rest.ensembl.org/variation/homo_sapiens/rs429358?content-type=application/json",
    ]);
    expect(
      answer.ok && answer.source === "Ensembl" && answer.fact.kind === "variant"
        ? answer.fact.mostSevereConsequence
        : null,
    ).toBe("missense_variant");
  });

  test("no rsID leaves while the genome is part of the turn", async () => {
    const { ports, events } = harness();
    const answer = await runEnsemblLookup(
      scope,
      { rsid: "rs429358" },
      { ...turn, genomeInTurn: true },
      ports,
    );
    expect([answer.ok ? null : answer.code, events]).toEqual(["LIVE_QUERY_REFUSED", []]);
  });

  test("both keys or none is refused", async () => {
    const { ports, events } = harness();
    const both = await runEnsemblLookup(
      scope,
      { symbol: "APOE", rsid: "rs429358" },
      turn,
      ports,
    );
    const none = await runEnsemblLookup(scope, {}, turn, ports);
    expect([both.ok ? null : both.code, none.ok ? null : none.code, events]).toEqual([
      "LIVE_QUERY_REFUSED",
      "LIVE_QUERY_REFUSED",
      [],
    ]);
  });

  test("an unknown symbol is not found", async () => {
    const { ports } = harness({ status: 400 });
    expect(await runEnsemblLookup(scope, { symbol: "NOTAGENE" }, turn, ports)).toEqual({
      ok: false,
      code: "LIVE_NOT_FOUND",
      error: "Ensembl has no human gene or variant by that name.",
    });
  });
});
