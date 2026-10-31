import { checksSection, LabScreen } from "@/features/lab/lab-screen";
import { loadResults } from "@/features/lab/load-results";
import { loadSimulation } from "@/features/lab/load-simulation";
import { RatingSection } from "@/features/lab/rating-section";
import { ResultsSection } from "@/features/lab/results-section";
import { loadVerifiability } from "@/features/lab/run-lab-checks";
import { SimulationsSection } from "@/features/lab/simulations-section";

const SIMULATIONS_INTRO =
  "Simulated heart rhythm recordings of synthetic people from the pinned evaluation cohort, made the same way the rhythm_irregularity tool makes them. Same person, day, length and number give the same recording. It describes recordings, never a person.";

const RATING_INTRO =
  "A second, blind rating of the answers to the heart-brain questions, next to the automatic scorer. One answer at a time, without the model or the score; ratings stay in a file beside each run, and bun run eval:agreement reports Cohen's kappa.";

const RESULTS_INTRO =
  "Evaluation runs and benchmark results found on this machine, read from their files. Each table has a CSV download for a paper's tables and figures.";

export default async function LabPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const params = await searchParams;
  const [verifiability, simulation, results] = await Promise.all([
    loadVerifiability(),
    loadSimulation(params),
    loadResults(),
  ]);
  return (
    <LabScreen
      sections={[
        checksSection(verifiability),
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
          body: <ResultsSection data={results} />,
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
