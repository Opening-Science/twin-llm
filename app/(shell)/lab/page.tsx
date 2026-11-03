import { redirect } from "next/navigation";

import { labHubCards, legacySimulationHref } from "@/features/lab/lab-hub";
import { LabHubScreen } from "@/features/lab/lab-hub-screen";
import { loadJobStates } from "@/features/lab/load-jobs";
import { countBenchmarkRuns, countRuns } from "@/features/lab/load-results";
import { countSubjects } from "@/features/lab/load-simulation";
import { LAB_CHECK_COUNT } from "@/features/lab/run-lab-checks";

/**
 * The hub is the page everyone passes through, so it only counts: run
 * folders, a stat per job, one database count. The checks run on
 * `/lab/checks`; the reports are read on the pages that show them.
 */
export default async function LabPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = await searchParams;
  const legacy = legacySimulationHref(params);
  if (legacy !== null) redirect(legacy);
  const [simulationSubjects, runs, benchmarkRuns, jobs] = await Promise.all([
    countSubjects(),
    countRuns(),
    countBenchmarkRuns(),
    loadJobStates(),
  ]);
  return (
    <LabHubScreen
      cards={labHubCards({
        checkCount: LAB_CHECK_COUNT,
        simulationSubjects,
        runs,
        benchmarkRuns,
        jobs,
      })}
    />
  );
}
