import { SubjectsScreen } from "@/features/data-explorer/data-screens";

export default async function DataSubjectsPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  return <SubjectsScreen params={await searchParams} />;
}
