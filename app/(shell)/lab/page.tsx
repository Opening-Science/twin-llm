import { checksSection, LabScreen } from "@/features/lab/lab-screen";
import { loadJobs, loadTimedChecks } from "@/features/lab/load-jobs";
import { loadResults } from "@/features/lab/load-results";
import { loadSimulation } from "@/features/lab/load-simulation";
import { RatingSection } from "@/features/lab/rating-section";
import { ResultsSection } from "@/features/lab/results-section";
import { SimulationsSection } from "@/features/lab/simulations-section";

const SIMULATIONS_INTRO =
  "Simulated heart rhythm recordings of synthetic people from the pinned evaluation cohort, made the same way the rhythm_irregularity tool makes them. Same person, day, length and number give the same recording. It describes recordings, never a person.";

const RATING_INTRO =
  "A second, blind rating of the answers to the heart-brain questions, next to the automatic scorer. One answer at a time, without the model or the score; ratings stay in a file beside each run, and bun run eval:agreement reports Cohen's kappa.";

const RESULTS_INTRO =
  "The last run of each long job, then the evaluation runs and benchmark results found on this machine, all read from their files. Each table has a CSV download for a paper's tables and figures.";

export default async function LabPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = await searchParams;
  const [checks, simulation, results] = await Promise.all([
    loadTimedChecks(),
    loadSimulation(params),
    loadResults(),
  ]);
  const jobs = await loadJobs(results.benchmark);
  return (
    <LabScreen
      sections={[
        checksSection(checks.section, checks.job),
        {
          id: "simulations",
          title: "Simulations",
          intro: SIMULATIONS_INTRO,
          body: <SimulationsSection data={simulation} />,
        },
        {
          id: "results",
          title: "Results",
          intro: RESULTS_INTRO,
          body: <ResultsSection data={results} jobs={jobs} />,
        },
        {
          id: "second-rating",
          title: "Second rating",
          intro: RATING_INTRO,
          body: <RatingSection />,
        },
      ]}
    />
  );
}
