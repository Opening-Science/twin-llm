import { LabDetail } from "@/features/lab/lab-detail";
import { loadSimulation } from "@/features/lab/load-simulation";
import { SimulationsSection } from "@/features/lab/simulations-section";

export default async function LabSimulationsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const simulation = await loadSimulation(await searchParams);
  return (
    <LabDetail
      part="simulations"
      about={
        <p>
          Recordings of synthetic people from the pinned evaluation cohort, made the same
          way the rhythm_irregularity tool makes them. The same person, day, length and
          number give the same recording, and the page address makes it again. It
          describes recordings, never a person.
        </p>
      }
    >
      <SimulationsSection data={simulation} />
    </LabDetail>
  );
}
