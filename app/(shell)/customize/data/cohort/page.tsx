import { OverviewScreen } from "@/features/data-explorer/data-screens";

/** The synthetic cohort at a glance (docs/warehouse.md, "Data page"). */
export default async function DataPage({
  searchParams,
}: {
  readonly searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}) {
  return <OverviewScreen params={await searchParams} />;
}
