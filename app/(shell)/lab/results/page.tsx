import { LabDetail } from "@/features/lab/lab-detail";
import { loadResearch } from "@/features/lab/load-research";
import { ResearchSection } from "@/features/lab/research-section";

export default async function LabResultsPage() {
  const data = await loadResearch();
  return (
    <LabDetail
      part="results"
      about={
        <>
          <p>
            Each figure reads one committed file in docs/research: the summary a study
            wrote, or, where a study has no machine-readable summary, one named table of
            its page. Every number shown is a number in that file. The page beside each
            summary says how the run was made and what it does not show.
          </p>
          <p>
            Synthetic people, simulated recordings and open annotated databases only. The
            figures describe methods and models, never a person.
          </p>
        </>
      }
    >
      <ResearchSection data={data} />
    </LabDetail>
  );
}
