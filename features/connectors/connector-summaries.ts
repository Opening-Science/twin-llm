import type { PersonalRead } from "@/infrastructure/personal-read-audit";

/**
 * The Oura, Whoop and Google Health summaries the Customize · Connectors page
 * shows, read with their audit row (#223). In personal mode each page view
 * writes one `personal.read.connectors-page` row (how many of the three had a
 * summary, never a value) before the page renders them. When the row cannot
 * be written this rejects and the page shows its error state, so nothing is
 * shown unaudited.
 */

export type ConnectorSummaryDeps<Oura, Whoop, GoogleHealth> = {
  readonly isPersonalMode: () => boolean;
  readonly getLatestOuraSummary: (userId: string) => Promise<Oura | null>;
  readonly getLatestWhoopSummary: (userId: string) => Promise<Whoop | null>;
  readonly getLatestGoogleHealthSummary: (userId: string) => Promise<GoogleHealth | null>;
  readonly auditPersonalRead: (read: PersonalRead) => Promise<unknown>;
};

export type ConnectorSummaries<Oura, Whoop, GoogleHealth> = Readonly<{
  ouraSummary: Oura | null;
  whoopSummary: Whoop | null;
  googleHealthSummary: GoogleHealth | null;
}>;

export const readConnectorSummaries = async <Oura, Whoop, GoogleHealth>(
  deps: ConnectorSummaryDeps<Oura, Whoop, GoogleHealth>,
  actor: string,
  userId: string,
): Promise<ConnectorSummaries<Oura, Whoop, GoogleHealth>> => {
  const [ouraSummary, whoopSummary, googleHealthSummary] = await Promise.all([
    deps.getLatestOuraSummary(userId),
    deps.getLatestWhoopSummary(userId),
    deps.getLatestGoogleHealthSummary(userId),
  ]);
  if (deps.isPersonalMode()) {
    await deps.auditPersonalRead({
      actor,
      purpose: "connectors-page",
      rowCount: [ouraSummary, whoopSummary, googleHealthSummary].filter(
        (summary) => summary != null,
      ).length,
    });
  }
  return { ouraSummary, whoopSummary, googleHealthSummary };
};
