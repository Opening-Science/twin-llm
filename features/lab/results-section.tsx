import { Card } from "@/infrastructure/ui-kit/card";

import { RHYTHM_BENCH_DIR } from "@/infrastructure/local-artefacts";

import { benchmarkRunLine, benchmarkTables } from "./benchmark-result";
import { DownloadButton } from "./download-button";
import { type EvalRun, runsCsv, runsTable, scoresCsv, scoreTable } from "./eval-runs";
import { LabTable } from "./lab-table";
import { type BenchmarkData, type ResultsData } from "./load-results";

/**
 * The Results section: evaluation runs found under `evaluation/runs/` and
 * the rhythm benchmark's result file, each table with a CSV download for a
 * paper's tables and figures. Server-rendered except the download buttons.
 */

const EVAL_COMMANDS = [
  "cp .env.synthetic.example .env.eval   # DATABASE_URL at a throwaway database",
  "bun run eval -- --models ollama:qwen3:4b --scenario S5",
  "bun run eval:report -- <run-id>",
].join("\n");

const BENCH_COMMAND = [
  `bun run rhythm-bench -- --out ${RHYTHM_BENCH_DIR}/<run> --seeds 3 --afdb <afdb-dir>`,
  "# without --afdb it runs on simulated recordings only",
].join("\n");

const Command = ({ label, text }: Readonly<{ label: string; text: string }>) => (
  <pre className="command-block" aria-label={label}>
    <code>{text}</code>
  </pre>
);

const SubHeading = ({ children }: Readonly<{ children: string }>) => (
  <h3 className="text-base font-medium">{children}</h3>
);

const RunScores = ({ run }: Readonly<{ run: EvalRun }>) => {
  if (run.scores === null) {
    return (
      <p className="text-muted-foreground text-sm">
        {run.id}: no report.md yet.{" "}
        <code className="setup-code">bun run eval:report -- {run.id}</code> writes it.
      </p>
    );
  }
  if (run.scores.length === 0) {
    return (
      <p className="text-muted-foreground text-sm">
        {run.id}: report.md has no score tables this page can read.
      </p>
    );
  }
  return (
    <>
      {run.scores.map((model) => (
        <div key={`${run.id}:${model.model}`} className="flex min-w-0 flex-col gap-2">
          <h4 className="text-sm font-medium break-all">
            {run.id} · {model.model}
          </h4>
          <LabTable table={scoreTable(model)} />
          <div className="flex flex-wrap gap-2">
            <DownloadButton
              label="Download CSV"
              fileName={`${run.id}-${model.model.replaceAll(/[^\w.-]+/g, "_")}-scores.csv`}
              mimeType="text/csv"
              text={scoresCsv([{ ...run, scores: [model] }])}
            />
          </div>
        </div>
      ))}
    </>
  );
};

const EvalRuns = ({ data }: Readonly<{ data: ResultsData }>) => (
  <Card padding="md" className="flex min-w-0 flex-col gap-3">
    <SubHeading>Evaluation runs</SubHeading>
    {data.runs.length === 0 ? (
      <>
        <p className="text-sm leading-relaxed">
          {data.failed
            ? `The runs folder (${data.runsDir}) could not be read just now. Reload the page to try again.`
            : `No evaluation runs on this machine. bun run eval writes them to ${data.runsDir}/ (gitignored), and bun run eval:report adds the report this page reads.`}
        </p>
        <Command label="Commands that make an evaluation run" text={EVAL_COMMANDS} />
      </>
    ) : (
      <>
        <p className="text-muted-foreground text-sm leading-relaxed">
          From each run&rsquo;s meta.json and report.md in {data.runsDir}/. A score is
          passes over scored answers (pass + fail) with the Wilson 95 % interval, as the
          report gives it; human, n/a and error lines never count as passes.
          {data.more ? " Only the newest 100 runs are listed." : ""}
        </p>
        <LabTable table={runsTable(data.runs)} />
        <div className="flex flex-wrap gap-2">
          <DownloadButton
            label="Download CSV"
            fileName="evaluation-runs.csv"
            mimeType="text/csv"
            text={runsCsv(data.runs)}
          />
        </div>
        {data.runs.map((run) => (
          <RunScores key={run.id} run={run} />
        ))}
      </>
    )}
  </Card>
);

const Benchmark = ({ data }: Readonly<{ data: BenchmarkData }>) => {
  const read = data.read;
  return (
    <Card padding="md" className="flex min-w-0 flex-col gap-3">
      <SubHeading>Rhythm benchmark</SubHeading>
      {read.kind === "found" && data.path !== null ? (
        <>
          <p className="text-muted-foreground text-sm leading-relaxed">
            {benchmarkRunLine(read.result)}. From{" "}
            <code className="setup-code">{data.path}</code>
            {data.runs > 1 ? `, the newest of ${data.runs} runs` : ""}. Point estimates
            with 95 % bootstrap intervals over recordings or records. It describes how
            methods do on recordings, not people.
          </p>
          {benchmarkTables(read.result).map((each) => (
            <div key={each.slug} className="flex min-w-0 flex-col gap-2">
              <h4 className="text-sm font-medium">{each.table.caption}</h4>
              <LabTable table={each.table} />
              <div className="flex flex-wrap gap-2">
                <DownloadButton
                  label="Download CSV"
                  fileName={`rhythm-bench-${read.result.runId}-${each.slug}.csv`}
                  mimeType="text/csv"
                  text={each.csv}
                />
              </div>
            </div>
          ))}
        </>
      ) : (
        <>
          <p className="text-sm leading-relaxed">
            {read.kind === "unreadable" && data.path !== null ? (
              <>
                The newest result file is not in the shape this page reads:{" "}
                <code className="setup-code">{data.path}</code>.
              </>
            ) : (
              <>
                Not run yet: there is no <code className="setup-code">result.json</code>{" "}
                in <code className="setup-code">{data.dir}/</code> (gitignored).
              </>
            )}
          </p>
          <Command label="Command that runs the rhythm benchmark" text={BENCH_COMMAND} />
        </>
      )}
    </Card>
  );
};

export const ResultsSection = ({ data }: Readonly<{ data: ResultsData }>) => (
  <div className="flex flex-col gap-4">
    <EvalRuns data={data} />
    <Benchmark data={data.benchmark} />
  </div>
);
