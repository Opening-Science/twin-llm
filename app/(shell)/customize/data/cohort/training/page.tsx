import { TrainingScreen } from "@/features/data-explorer/data-screens";

export default async function DataTrainingPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  return <TrainingScreen params={await searchParams} />;
}
