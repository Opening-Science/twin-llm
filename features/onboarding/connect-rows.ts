import type { KnowledgeSourceId } from "@/infrastructure/knowledge-sources";
import type { DataMode } from "@/infrastructure/data-mode-policy";

/**
 * What the "Connect your data" and "Knowledge sources" steps show, built from
 * facts the server read. Pure, so the words for each state are tested.
 *
 * Nothing here pretends a connection exists: a row is "Linked" only when the
 * server found a stored connection, and the action is the same authorize link
 * the Connectors page uses, or a link to that page for setups that need it.
 */

export type ConnectorFacts = Readonly<{
  configured: boolean;
  connected: boolean;
}>;

export type ConnectFacts = Readonly<{
  oura: ConnectorFacts;
  whoop: ConnectorFacts;
  googleHealth: ConnectorFacts;
  bodyloop: ConnectorFacts;
  /** `GENOME_SOURCE=ark`; the device itself is checked under Customize · Connectors. */
  arkEnabled: boolean;
}>;

export type ConnectState = "linked" | "ready" | "not-set-up" | "on";

export type ConnectAction = Readonly<{ label: string; href: string; external: boolean }>;

export type ConnectRow = Readonly<{
  id: "oura" | "whoop" | "google-health" | "bodyloop" | "ark";
  name: string;
  purpose: string;
  state: ConnectState;
  stateLabel: string;
  action: ConnectAction | null;
}>;

export type ConnectGroup = Readonly<{ label: string; rows: readonly ConnectRow[] }>;

const STATE_LABEL: Readonly<Record<ConnectState, string>> = {
  linked: "Linked",
  ready: "Not linked",
  "not-set-up": "Not set up",
  on: "Turned on",
};

const wearableRow = (
  id: "oura" | "whoop" | "google-health",
  name: string,
  purpose: string,
  facts: ConnectorFacts,
): ConnectRow => {
  const state: ConnectState = !facts.configured
    ? "not-set-up"
    : facts.connected
      ? "linked"
      : "ready";
  return {
    id,
    name,
    purpose,
    state,
    stateLabel: STATE_LABEL[state],
    action:
      state === "ready"
        ? { label: `Link ${name}`, href: `/api/${id}/authorize`, external: true }
        : state === "not-set-up"
          ? { label: "Setup steps", href: `/connectors?source=${id}`, external: false }
          : null,
  };
};

export const connectGroups = (facts: ConnectFacts): readonly ConnectGroup[] => {
  const bodyloopState: ConnectState = !facts.bodyloop.configured
    ? "not-set-up"
    : facts.bodyloop.connected
      ? "linked"
      : "ready";
  return [
    {
      label: "Wearables",
      rows: [
        wearableRow("oura", "Oura", "Sleep, readiness and activity.", facts.oura),
        wearableRow("whoop", "Whoop", "Recovery, strain and sleep.", facts.whoop),
        wearableRow(
          "google-health",
          "Google Health",
          "Steps, sleep, HRV and activity from a Fitbit-linked account.",
          facts.googleHealth,
        ),
      ],
    },
    {
      label: "Body scan",
      rows: [
        {
          id: "bodyloop",
          name: "BodyLoop",
          purpose: "Body measurements from a scanner on your local network.",
          state: bodyloopState,
          stateLabel: STATE_LABEL[bodyloopState],
          action:
            bodyloopState === "linked"
              ? null
              : {
                  label: "Open Connectors",
                  href: "/customize/connectors",
                  external: false,
                },
        },
      ],
    },
    {
      label: "Genome",
      rows: [
        {
          id: "ark",
          name: "Ark",
          purpose: "Genome stays on the device; TwinLLM reads its status only.",
          state: facts.arkEnabled ? "on" : "not-set-up",
          stateLabel: STATE_LABEL[facts.arkEnabled ? "on" : "not-set-up"],
          action: {
            label: "Check on Connectors",
            href: "/customize/connectors",
            external: false,
          },
        },
      ],
    },
  ];
};

/** Display names of linked sources, for the starter prompt. */
export const linkedNames = (groups: readonly ConnectGroup[]): readonly string[] =>
  groups.flatMap((group) =>
    group.rows.filter((row) => row.state === "linked").map((row) => row.name),
  );

export type SourceFacts = Readonly<{
  dataMode: DataMode;
  guidelineDocuments: number;
  knowledgeDocuments: number;
  gbdConfigured: boolean;
  /** The genome policy allows chat here (`infrastructure/genome-gate.ts`). */
  genomeChat: boolean;
  /** The imported-data policy allows chat here (`infrastructure/imported-data-gate.ts`). */
  importedChat: boolean;
}>;

export type SourceAvailability = Readonly<{ available: boolean; note: string | null }>;

/**
 * Whether each source can answer on this server. An unavailable source shows
 * a word instead of a toggle, and its stored setting is kept.
 */
export const sourceAvailability = (
  facts: SourceFacts,
): Readonly<Record<KnowledgeSourceId, SourceAvailability>> => {
  const cohort: SourceAvailability =
    facts.dataMode === "synthetic"
      ? { available: true, note: null }
      : { available: false, note: "Synthetic data mode only" };
  return {
    guidelines:
      facts.guidelineDocuments > 0
        ? { available: true, note: null }
        : { available: false, note: "Not indexed yet" },
    "opentwin-knowledge":
      facts.knowledgeDocuments > 0
        ? { available: true, note: null }
        : { available: false, note: "Not indexed yet" },
    "cohort-records": cohort,
    "cohort-analytics": cohort,
    // Linked snapshots in personal mode, a synthetic subject's series in synthetic mode.
    "wearable-analytics": { available: true, note: null },
    gbd: facts.gbdConfigured
      ? { available: true, note: null }
      : { available: false, note: "Pending IHME's OK" },
    "ark-genome": facts.genomeChat
      ? { available: true, note: null }
      : { available: false, note: "Needs Ark and local Carbon-X" },
    "imported-data": facts.importedChat
      ? { available: true, note: null }
      : { available: false, note: "Personal mode and a local model only" },
  };
};
