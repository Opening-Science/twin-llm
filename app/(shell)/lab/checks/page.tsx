import { CheckList } from "@/features/lab/check-list";
import { JobLines } from "@/features/lab/job-lines";
import { LabDetail } from "@/features/lab/lab-detail";
import { loadTimedChecks } from "@/features/lab/load-jobs";

/** The checks run on this load, as one list; each row opens the check's page (#459). */
export default async function LabChecksPage() {
  const { section, job } = await loadTimedChecks();
  return (
    <LabDetail part="checks" about={<p>{section.intro}</p>}>
      <JobLines jobs={[job]} refresh={false} />
      <CheckList checks={section.checks} />
    </LabDetail>
  );
}
