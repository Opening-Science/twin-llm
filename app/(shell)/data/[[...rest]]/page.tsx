import { permanentRedirect } from "next/navigation";

/**
 * The synthetic cohort explorer moved to Customize · Data. Old links (the
 * README, docs, bookmarks) land on the same view, with their query.
 */
export default async function DataMoved({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ rest?: string[] }>;
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>) {
  const { rest = [] } = await params;
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const each of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value]) {
      query.append(key, each);
    }
  }
  const path = ["/customize/data/cohort", ...rest.map(encodeURIComponent)].join("/");
  const search = query.toString();
  permanentRedirect(search === "" ? path : `${path}?${search}`);
}
