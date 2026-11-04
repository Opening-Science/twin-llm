import { CheckCard } from "@/features/lab/check-card";
import { JobLines } from "@/features/lab/job-lines";
import { LabDetail } from "@/features/lab/lab-detail";
import { loadTimedChecks } from "@/features/lab/load-jobs";

export default async function LabChecksPage() {
  const { section, job } = await loadTimedChecks();
  return (
    <LabDetail part="checks" about={<p>{section.intro}</p>}>
      <JobLines jobs={[job]} refresh={false} />
      <div className="flex flex-col gap-4">
        {section.checks.map((check) => (
          <CheckCard key={check.id} check={check} />
        ))}
      </div>
    </LabDetail>
  );
}
