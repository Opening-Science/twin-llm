import { SubjectScreen } from "@/features/data-explorer/data-screens";

export default async function DataSubjectPage({
  params,
}: {
  readonly params: Promise<{ readonly subjectRef: string }>;
}) {
  const { subjectRef } = await params;
  return <SubjectScreen subjectRef={subjectRef} />;
}
