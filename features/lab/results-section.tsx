import { RHYTHM_BENCH_DIR } from "@/infrastructure/local-artefacts";

import { benchmarkRunLine, benchmarkTables } from "./benchmark-result";
import { DownloadButton } from "./download-button";
import { JobLines } from "./job-lines";
import { type LabJob } from "./lab-jobs";
import { type EvalRun, runsCsv, runsTable, scoresCsv, scoreTable } from "./eval-runs";
import { LabTable } from "./lab-table";
import { type BenchmarkData, type ResultsData } from "./load-results";

/**
 * The bodies of three Lab pages: evaluation runs found under
 * `evaluation/runs/`, the rhythm benchmark's result file and the long jobs,
 * each table with a CSV download for a paper's tables and figures.
 * Server-rendered except the download buttons. The page frame
 * (`lab-detail.tsx`) gives each its title.
 */

const EVAL_COMMANDS = [
  "cp .env.synthetic.example .env.eval   # DATABASE_URL at a throwaway database",
  "bun run eval -- --models ollama:qwen3:4b --scenario S5",
  "bun run eval:report -- <run-id>",
].join("\n");

const BENCH_COMMAND = [
  `bun run rhythm-bench -- --out ${RHYTHM_BENCH_DIR}/<run> --seeds 3 --afdb <afdb-dir>`,
  "# --ltafdb <dir> reads the Long-Term AF Database instead; with neither it runs on simulated recordings only",
].join("\n");

const Command = ({ label, text }: Readonly<{ label: string; text: string }>) => (
  <pre className="command-block" aria-label={label}>
    <code>{text}</code>
  </pre>
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
          <h2 className="text-base font-medium break-all">
            {run.id} · {model.model}
          </h2>
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

export const EvalRunsBody = ({ data }: Readonly<{ data: ResultsData }>) => (
  <div className="flex min-w-0 flex-col gap-4">
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
  </div>
);

export const BenchmarkBody = ({ data }: Readonly<{ data: BenchmarkData }>) => {
  const read = data.read;
  return (
    <div className="flex min-w-0 flex-col gap-4">
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
              <h2 className="text-base font-medium">{each.table.caption}</h2>
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
    </div>
  );
};

export const LongJobsBody = ({ jobs }: Readonly<{ jobs: readonly LabJob[] }>) => (
  <div className="flex min-w-0 flex-col gap-3">
    <JobLines jobs={jobs} />
  </div>
);
