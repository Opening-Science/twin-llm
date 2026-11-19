import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { summariseRun } from "./eval-runs";
import { type ResultsData } from "./load-results";
import { BenchmarkBody, EvalRunsBody } from "./results-section";

const REPORT = [
  "## Scores: ollama:qwen3:4b",
  "",
  "| Criterion | S3 | All |",
  "| --- | --- | --- |",
  "| correctness | 3/4 (30–95 %) | 3/4 (30–95 %) |",
  "",
].join("\n");

const CLAIMS = [
  "## Claim sources",
  "",
  "| Model | Answers | Claims | Cited | Marked unsupported | Invented id | Uncited | Answers fully covered |",
  "| --- | --- | --- | --- | --- | --- | --- | --- |",
  "| ollama:qwen3:4b | 4 | 10 | 6/10 (31–83 %) | 1/10 (2–40 %) | 0/10 (0–28 %) | 3/10 (11–60 %) | 2/4 (15–85 %) |",
  "",
].join("\n");

const data = (report: string): ResultsData => ({
  runsDir: "evaluation/runs",
  runs: [summariseRun("2026-11-17-run", null, report)],
  more: false,
  failed: false,
  benchmark: { dir: "x", runs: 0, path: null, read: { kind: "missing" } },
});

describe("EvalRunsBody claim sources (#612)", () => {
  test("a report with claim sources shows their table and a CSV download", () => {
    const html = renderToStaticMarkup(
      <EvalRunsBody data={data(`${REPORT}\n${CLAIMS}`)} />,
    );
    expect(html).toContain("2026-11-17-run · claim sources");
    expect(html).toContain("6/10 · 31–83 %");
    expect(html).toContain("Download CSV");
    expect(html).toContain("Fully covered: at least one claim, every one cited");
  });

  test("a report without them shows no claim-sources block", () => {
    const html = renderToStaticMarkup(<EvalRunsBody data={data(REPORT)} />);
    expect(html).not.toContain("claim sources");
  });
});

describe("Lab commands on a phone", () => {
  const lines = (html: string) => html.match(/class="command-line"/g)?.length ?? 0;

  test("the evaluation commands wrap one line per command, as on the checks", () => {
    const html = renderToStaticMarkup(
      <EvalRunsBody data={{ ...data(REPORT), runs: [] }} />,
    );
    expect(lines(html)).toBe(3);
  });

  test("the benchmark command and its note wrap one line each", () => {
    const html = renderToStaticMarkup(
      <BenchmarkBody
        data={{ dir: ".rhythm-bench", runs: 0, path: null, read: { kind: "missing" } }}
      />,
    );
    expect(lines(html)).toBe(2);
  });
});
