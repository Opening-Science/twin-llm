import { LabDetail } from "@/features/lab/lab-detail";
import { loadResults } from "@/features/lab/load-results";
import { BenchmarkBody } from "@/features/lab/results-section";

export default async function LabBenchmarkPage() {
  const { benchmark } = await loadResults();
  return (
    <LabDetail
      part="benchmark"
      about={
        <p>
          The newest result file of bun run rhythm-bench, read as the benchmark wrote it.
          It describes how methods do on recordings, not people. Each table has a CSV
          download.
        </p>
      }
    >
      <BenchmarkBody data={benchmark} />
    </LabDetail>
  );
}
