import { LabDetail } from "@/features/lab/lab-detail";
import { loadJobs } from "@/features/lab/load-jobs";
import { loadResults } from "@/features/lab/load-results";
import { LongJobsBody } from "@/features/lab/results-section";

export default async function LabJobsPage() {
  const { benchmark } = await loadResults();
  const jobs = await loadJobs(benchmark);
  return (
    <LabDetail
      part="jobs"
      about={
        <p>
          The newest evaluation run, rhythm benchmark and Synthea cohort, each read from
          the files it writes. The page starts none of them; while one runs it looks again
          every few seconds.
        </p>
      }
    >
      <LongJobsBody jobs={jobs} />
    </LabDetail>
  );
}
