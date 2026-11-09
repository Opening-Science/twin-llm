import {
  KNOWLEDGE_SOURCE_GROUPS,
  type KnowledgeSourceId,
  normaliseDisabledSources,
  setSourceEnabled,
} from "@/infrastructure/knowledge-sources";
import {
  LIVE_SOURCES,
  type LiveSourceId,
  normaliseLiveSources,
  setLiveSourceEnabled,
} from "@/infrastructure/live-sources";

/**
 * Settings (#507): every keep or withhold choice in one list, each with what
 * it does in one sentence, its safe default for the data mode, and whether it
 * is at that default. Pure, so the server renders the first view and the
 * client recomputes it after a switch.
 *
 * Nothing here stores anything. The values come from the stores the choices
 * already had (the onboarding profile's `twinNotesOff`, `disabledSources` and
 * `liveSources`, and the learning consents); the rules that refuse a looser
 * setting than the data mode allows stay in their gates and are only shown.
 */

export type DataMode = "personal" | "synthetic";

export type SourceAvailability = Readonly<{ available: boolean; note: string | null }>;

/** The stored choices a person can switch here. */
export type SettingsState = Readonly<{
  notesOn: boolean;
  disabledSources: readonly KnowledgeSourceId[];
  liveSources: readonly LiveSourceId[];
}>;

/** What this server allows, read once on the server. */
export type SettingsFacts = Readonly<{
  mode: DataMode;
  localOnly: boolean;
  signedIn: boolean;
  availability: Readonly<Record<KnowledgeSourceId, SourceAvailability>>;
  /** Learning uses consented to now; always 0 in synthetic mode. */
  activeConsents: number;
  dataModeSentence: string;
  howToSwitch: string;
}>;

/**
 * Safe defaults per data mode. They are the same for both modes today: twin
 * notes load (their own permit still filters them per turn), every knowledge
 * source is on (each source's gate decides per turn and per mode), and every
 * live public lookup is off. Kept per mode so a mode can tighten one later.
 */
export const SETTING_DEFAULTS: Readonly<Record<DataMode, SettingsState>> = {
  personal: { notesOn: true, disabledSources: [], liveSources: [] },
  synthetic: { notesOn: true, disabledSources: [], liveSources: [] },
};

export type SwitchTarget =
  | Readonly<{ setting: "notes" }>
  | Readonly<{ setting: "source"; id: KnowledgeSourceId }>
  | Readonly<{ setting: "live"; id: LiveSourceId }>;

export type SettingControl =
  | Readonly<{
      kind: "switch";
      target: SwitchTarget;
      on: boolean;
      /** Asked before the riskier way is chosen; null when neither way is riskier. */
      confirmOn: string | null;
      /** Why it cannot be switched here; null when it can. */
      locked: string | null;
    }>
  | Readonly<{ kind: "fixed"; value: string }>
  | Readonly<{ kind: "link"; value: string; href: string; label: string }>;

export type SettingRow = Readonly<{
  key: string;
  title: string;
  /** What the choice does, in one plain sentence. */
  does: string;
  /** The safe default, in words. */
  safeDefault: string;
  isDefault: boolean;
  /**
   * Why this server cannot use the choice at all (the data mode, local-only
   * mode or a missing service); null when it can. Such a row shows
   * "Unavailable" and its reason instead of a default badge, and is left out
   * of the summary.
   */
  unavailable: string | null;
  control: SettingControl;
}>;

export type SettingsSection = Readonly<{
  id: string;
  title: string;
  intro: string;
  rows: readonly SettingRow[];
}>;

const LOCAL_ONLY_REASON =
  "Off on this server: local-only mode sends nothing to public databases.";

const onOff = (on: boolean): string => (on ? "On" : "Off");

const sameIds = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((id) => b.includes(id));

export const isAtDefaults = (mode: DataMode, state: SettingsState): boolean => {
  const safe = SETTING_DEFAULTS[mode];
  return (
    state.notesOn === safe.notesOn &&
    sameIds(normaliseDisabledSources(state.disabledSources), safe.disabledSources) &&
    sameIds(normaliseLiveSources(state.liveSources), safe.liveSources)
  );
};

const notesRow = (facts: SettingsFacts, state: SettingsState): SettingRow => {
  const safe = SETTING_DEFAULTS[facts.mode].notesOn;
  return {
    key: "notes",
    title: "Twin notes in new chats and skill runs",
    does: "Loads the notes you saved with /compact into a new chat or skill run, newest first; incognito chats never load them.",
    safeDefault: onOff(safe),
    isDefault: state.notesOn === safe,
    unavailable: null,
    control: {
      kind: "switch",
      target: { setting: "notes" },
      on: state.notesOn,
      confirmOn: null,
      locked: facts.signedIn ? null : "Sign in to change this.",
    },
  };
};

const sourceRows = (
  facts: SettingsFacts,
  state: SettingsState,
): readonly SettingRow[] => {
  const safe = SETTING_DEFAULTS[facts.mode].disabledSources;
  const off = normaliseDisabledSources(state.disabledSources);
  return KNOWLEDGE_SOURCE_GROUPS.flatMap((group) =>
    group.sources.map((source): SettingRow => {
      const usable = facts.availability[source.id];
      const on = !off.includes(source.id);
      return {
        key: `source-${source.id}`,
        title: `${group.label}: ${source.label}`,
        does: source.description,
        safeDefault: onOff(!safe.includes(source.id)),
        isDefault: on === !safe.includes(source.id),
        unavailable: usable.available
          ? null
          : (usable.note ?? "Not available on this server."),
        control: {
          kind: "switch",
          target: { setting: "source", id: source.id },
          // A source this server cannot use answers nothing, whatever is stored.
          on: usable.available && on,
          confirmOn: null,
          locked: !usable.available
            ? (usable.note ?? "Not available on this server.")
            : facts.signedIn
              ? null
              : "Sign in to change this.",
        },
      };
    }),
  );
};

const liveRows = (facts: SettingsFacts, state: SettingsState): readonly SettingRow[] => {
  const safe = SETTING_DEFAULTS[facts.mode].liveSources;
  const enabled = facts.localOnly ? [] : normaliseLiveSources(state.liveSources);
  return LIVE_SOURCES.map((source): SettingRow => {
    const on = enabled.includes(source.id);
    return {
      key: `live-${source.id}`,
      title: `Live ${source.label} lookups`,
      does: `${source.description} Each lookup goes to ${source.recipient} and is listed under Customize · Privacy first.`,
      safeDefault: onOff(safe.includes(source.id)),
      isDefault: on === safe.includes(source.id),
      unavailable: facts.localOnly ? LOCAL_ONLY_REASON : null,
      control: {
        kind: "switch",
        target: { setting: "live", id: source.id },
        on,
        confirmOn: `Turn on live ${source.label} lookups? Sent to ${source.recipient}: ${source.sends}`,
        locked: facts.localOnly
          ? LOCAL_ONLY_REASON
          : facts.signedIn
            ? null
            : "Sign in to change this.",
      },
    };
  });
};

const fixedRows = (facts: SettingsFacts): readonly SettingRow[] => [
  {
    key: "skill-wearables",
    title: "Your own skills on a hosted model",
    does: "A skill you write may run on a hosted model, and your wearable data is withheld from it unless the skill reads wearables and lists only models allowed personal data.",
    safeDefault: "Wearables withheld",
    isDefault: true,
    unavailable: null,
    control: { kind: "fixed", value: "Wearables withheld" },
  },
  {
    key: "imports-genome",
    title: "Imported data and your genome",
    does: "Imported records, wearable exports, VCF variants and genome reports are read only by a model on this machine, never sent to a hosted one.",
    safeDefault: "This machine only",
    isDefault: true,
    unavailable: null,
    control: {
      kind: "fixed",
      value: facts.mode === "personal" ? "This machine only" : "Off in synthetic mode",
    },
  },
  {
    key: "ledger",
    title: "Record of what left this machine",
    does: "Everything sent off this machine is written to the disclosure ledger before it is sent, or not sent at all.",
    safeDefault: "Always on",
    isDefault: true,
    unavailable: null,
    control: {
      kind: "link",
      value: "Always on",
      href: "/customize/privacy",
      label: "See the ledger",
    },
  },
];

const consentRow = (facts: SettingsFacts): SettingRow => ({
  key: "learning-consent",
  title: "Learning from your data",
  does: "Lets TwinLLM's training, answer-key or evaluation pipelines read your own data, per use and per kind of data, until you withdraw.",
  safeDefault: "Off",
  isDefault: facts.activeConsents === 0,
  unavailable: null,
  control: {
    kind: "link",
    value:
      facts.mode === "synthetic"
        ? "Not needed: synthetic data only"
        : facts.activeConsents === 0
          ? "Off"
          : `On for ${String(facts.activeConsents)} ${facts.activeConsents === 1 ? "use" : "uses"}`,
    href: "/customize/privacy",
    label: "Change on Customize · Privacy",
  },
});

const serverRows = (facts: SettingsFacts): readonly SettingRow[] => [
  {
    key: "data-mode",
    title: "Data mode",
    does: `${facts.dataModeSentence} ${facts.howToSwitch}`,
    safeDefault: "Set by whoever runs TwinLLM",
    isDefault: true,
    unavailable: null,
    control: {
      kind: "fixed",
      value: facts.mode === "personal" ? "Personal" : "Synthetic",
    },
  },
  {
    key: "local-only",
    title: "Local-only mode",
    does: "Keeps every model on this machine and sends nothing to public databases or analytics.",
    safeDefault: "Set by whoever runs TwinLLM",
    isDefault: true,
    unavailable: null,
    control: { kind: "fixed", value: onOff(facts.localOnly) },
  },
];

export const settingsSections = (
  facts: SettingsFacts,
  state: SettingsState,
): readonly SettingsSection[] => [
  {
    id: "reads",
    title: "What a chat may read",
    intro:
      "A source that is off is left out of every chat answer and skill run. A skill can only narrow these, never widen them.",
    rows: [notesRow(facts, state), ...sourceRows(facts, state)],
  },
  {
    id: "leaves",
    title: "What may leave this machine",
    intro:
      "Off or withheld unless you choose otherwise. Turning a lookup on asks you to confirm first.",
    rows: [...liveRows(facts, state), ...fixedRows(facts)],
  },
  {
    id: "learning",
    title: "Learning from your data",
    intro: "Every use is off until you grant it, with the exact wording, on Privacy.",
    rows: [consentRow(facts)],
  },
  {
    id: "server",
    title: "Set for this server",
    intro: "These cap everything above. They cannot be switched from the browser.",
    rows: serverRows(facts),
  },
];

/**
 * How many choices differ from their safe default, counting only the ones
 * this server can use: an unavailable row is neither at nor away from it.
 */
export const changedFromDefault = (sections: readonly SettingsSection[]): number =>
  sections
    .flatMap((section) => section.rows)
    .filter((row) => row.unavailable === null && !row.isDefault).length;

/** The state after one switch, before it is saved. */
export const withSwitch = (
  state: SettingsState,
  target: SwitchTarget,
  on: boolean,
): SettingsState => {
  switch (target.setting) {
    case "notes":
      return { ...state, notesOn: on };
    case "source":
      return {
        ...state,
        disabledSources: setSourceEnabled(state.disabledSources, target.id, on),
      };
    case "live":
      return {
        ...state,
        liveSources: setLiveSourceEnabled(state.liveSources, target.id, on),
      };
  }
};
