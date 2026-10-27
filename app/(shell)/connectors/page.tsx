import { permanentRedirect } from "next/navigation";

/**
 * Connectors moved under Customize. Sign-in returns (Oura, Whoop, Google
 * Health) still come back here with their query, so it is carried over.
 */
export default async function ConnectorsMoved({
  searchParams,
}: Readonly<{
  searchParams: Promise<Readonly<Record<string, string | string[] | undefined>>>;
}>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const each of Array.isArray(value)
      ? value
      : value === undefined
        ? []
        : [value]) {
      params.append(key, each);
    }
  }
  const query = params.toString();
  permanentRedirect(`/customize/connectors${query === "" ? "" : `?${query}`}`);
}
