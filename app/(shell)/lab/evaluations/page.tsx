import { LabDetail } from "@/features/lab/lab-detail";
import { loadResults } from "@/features/lab/load-results";
import { EvalRunsBody } from "@/features/lab/results-section";

export default async function LabEvaluationsPage() {
  const results = await loadResults();
  return (
    <LabDetail
      part="evaluations"
      about={
        <p>
          Read from each run&rsquo;s files on this machine, written by bun run eval and
          bun run eval:report. Each table has a CSV download for a paper&rsquo;s tables
          and figures.
        </p>
      }
    >
      <EvalRunsBody data={results} />
    </LabDetail>
  );
}
