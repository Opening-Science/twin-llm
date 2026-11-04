import { notFound } from "next/navigation";

import { CheckDetail, Prose } from "@/features/lab/check-detail";
import { LAB_PATH, LAB_TITLE } from "@/features/lab/lab-hub";
import { LabDetail } from "@/features/lab/lab-detail";
import { loadCheck } from "@/features/lab/run-lab-checks";

/**
 * One check on its own page (#459): the check runs on this load, the lead
 * line says what it found, the body has the evidence and the command. An
 * id no check has is a 404.
 */
export default async function LabCheckPage({
  params,
}: Readonly<{ params: Promise<{ checkId: string }> }>) {
  const { checkId } = await params;
  const check = await loadCheck(checkId);
  if (check === null) notFound();
  return (
    <LabDetail
      part="checks"
      title={check.title}
      line={<Prose text={check.summary} />}
      back={{ href: LAB_PATH.checks, label: LAB_TITLE.checks }}
    >
      <CheckDetail check={check} />
    </LabDetail>
  );
}
