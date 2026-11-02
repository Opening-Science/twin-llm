import { redirect } from "next/navigation";

import { labHubCards, legacySimulationHref } from "@/features/lab/lab-hub";
import { LabHubScreen } from "@/features/lab/lab-hub-screen";
import { loadJobs, loadTimedChecks } from "@/features/lab/load-jobs";
import { loadResults } from "@/features/lab/load-results";
import { loadSimulation } from "@/features/lab/load-simulation";

export default async function LabPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = await searchParams;
  const legacy = legacySimulationHref(params);
  if (legacy !== null) redirect(legacy);
  const [checks, simulation, results] = await Promise.all([
    loadTimedChecks(),
    loadSimulation({}),
    loadResults(),
  ]);
  const jobs = await loadJobs(results.benchmark);
  return (
    <LabHubScreen
      cards={labHubCards({
        checks: checks.section.checks.map((check) => check.status),
        simulationSubjects:
          simulation.kind === "synthetic" ? simulation.subjects.length : null,
        runs: { count: results.runs.length, more: results.more, failed: results.failed },
        benchmark: {
          found: results.benchmark.read.kind === "found",
          runs: results.benchmark.runs,
        },
        jobs: jobs.map((job) => job.state),
      })}
    />
  );
}
