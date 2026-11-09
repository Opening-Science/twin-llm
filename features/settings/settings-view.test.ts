import { describe, expect, test } from "bun:test";

import {
  KNOWLEDGE_SOURCE_IDS,
  type KnowledgeSourceId,
} from "@/infrastructure/knowledge-sources";

import {
  changedFromDefault,
  isAtDefaults,
  SETTING_DEFAULTS,
  type SettingRow,
  type SettingsFacts,
  settingsSections,
  type SettingsState,
  withSwitch,
} from "./settings-view";

const allAvailable = Object.fromEntries(
  KNOWLEDGE_SOURCE_IDS.map((id) => [id, { available: true, note: null }]),
) as Record<KnowledgeSourceId, { available: boolean; note: string | null }>;

const facts = (overrides: Partial<SettingsFacts> = {}): SettingsFacts => ({
  mode: "personal",
  localOnly: false,
  signedIn: true,
  availability: allAvailable,
  activeConsents: 0,
  dataModeSentence: "This server runs on personal data.",
  howToSwitch: "Whoever runs TwinLLM here sets this.",
  ...overrides,
});

const rows = (f: SettingsFacts, state: SettingsState): readonly SettingRow[] =>
  settingsSections(f, state).flatMap((section) => section.rows);

const row = (f: SettingsFacts, state: SettingsState, key: string): SettingRow => {
  const found = rows(f, state).find((item) => item.key === key);
  if (found === undefined) throw new Error(`no row ${key}`);
  return found;
};

describe("safe defaults", () => {
  test("are the same, and the safe ones, in both data modes", () => {
    const expected: SettingsState = {
      notesOn: true,
      disabledSources: ["ark-genome", "vcf-variants", "imported-data"],
      liveSources: [],
    };
    expect(SETTING_DEFAULTS.personal).toEqual(expected);
    expect(SETTING_DEFAULTS.synthetic).toEqual(expected);
  });

  test("someone who never chose sees every row at its default", () => {
    for (const mode of ["personal", "synthetic"] as const) {
      const all = rows(facts({ mode }), SETTING_DEFAULTS[mode]);
      expect(all.filter((item) => !item.isDefault).map((item) => item.key)).toEqual([]);
      expect(isAtDefaults(mode, SETTING_DEFAULTS[mode])).toBe(true);
    }
  });

  test("each row says what it does and its safe default", () => {
    const all = rows(facts(), SETTING_DEFAULTS.personal);
    expect(all.filter((item) => item.does === "" || item.safeDefault === "")).toEqual([]);
    expect(row(facts(), SETTING_DEFAULTS.personal, "notes").safeDefault).toBe("On");
    expect(row(facts(), SETTING_DEFAULTS.personal, "live-pubmed").safeDefault).toBe(
      "Off",
    );
    expect(row(facts(), SETTING_DEFAULTS.personal, "skill-wearables").control).toEqual({
      kind: "fixed",
      value: "Wearables withheld",
    });
  });

  test("lists every inventoried choice once", () => {
    expect(rows(facts(), SETTING_DEFAULTS.personal).map((item) => item.key)).toEqual([
      "notes",
      ...KNOWLEDGE_SOURCE_IDS.map((id) => `source-${id}`),
      "live-pubmed",
      "live-ensembl",
      "skill-wearables",
      "imports-genome",
      "ledger",
      "learning-consent",
      "data-mode",
      "local-only",
    ]);
  });
});

describe("riskier choices", () => {
  test("turning a lookup or a personal-data source on asks first; the rest do not", () => {
    const switches = rows(facts(), SETTING_DEFAULTS.personal).flatMap((item) =>
      item.control.kind === "switch" && item.control.confirmOn !== null ? [item.key] : [],
    );
    expect(switches).toEqual([
      "source-ark-genome",
      "source-vcf-variants",
      "source-imported-data",
      "live-pubmed",
      "live-ensembl",
    ]);
  });

  test("a live lookup that is on reads as changed from the default", () => {
    const state = withSwitch(
      SETTING_DEFAULTS.personal,
      { setting: "live", id: "pubmed" },
      true,
    );
    expect(state.liveSources).toEqual(["pubmed"]);
    expect(row(facts(), state, "live-pubmed").isDefault).toBe(false);
    expect(isAtDefaults("personal", state)).toBe(false);
  });
});

describe("the data mode caps every choice", () => {
  test("local-only mode shows live lookups off and locked, whatever is stored", () => {
    const control = row(
      facts({ localOnly: true }),
      { ...SETTING_DEFAULTS.personal, liveSources: ["pubmed"] },
      "live-pubmed",
    ).control;
    expect(control).toEqual({
      kind: "switch",
      target: { setting: "live", id: "pubmed" },
      on: false,
      confirmOn:
        "Turn on live PubMed lookups? Sent to NCBI (US National Library of Medicine): The search terms the model writes for a lookup, then the PubMed ids NCBI sent back, to fetch their titles and abstracts. Each request names this app, and the operator's contact address when one is set. NCBI also sees this machine's internet address.",
      locked: "Off on this server: local-only mode sends nothing to public databases.",
    });
  });

  test("a source this server cannot use cannot be switched", () => {
    const f = facts({
      mode: "synthetic",
      availability: {
        ...allAvailable,
        "imported-data": {
          available: false,
          note: "Personal mode and a local model only",
        },
      },
    });
    const control = row(f, SETTING_DEFAULTS.synthetic, "source-imported-data").control;
    expect(control).toEqual({
      kind: "switch",
      target: { setting: "source", id: "imported-data" },
      on: false,
      confirmOn:
        "Turn on Imported records and wearable exports? A model on this machine may then read it in your chats and skill runs. It is never sent to a hosted model, and you can turn it off here at any time.",
      locked: "Personal mode and a local model only",
    });
  });

  test("synthetic mode needs no learning consent", () => {
    expect(
      row(facts({ mode: "synthetic" }), SETTING_DEFAULTS.synthetic, "learning-consent")
        .control,
    ).toEqual({
      kind: "link",
      value: "Not needed: synthetic data only",
      href: "/customize/privacy",
      label: "Change on Customize · Privacy",
    });
  });

  test("signed out, every switch is locked", () => {
    const locked = rows(facts({ signedIn: false }), SETTING_DEFAULTS.personal).flatMap(
      (item) =>
        item.control.kind === "switch" && item.control.locked === null ? [item.key] : [],
    );
    expect(locked).toEqual([]);
  });
});

describe("withSwitch", () => {
  test("turning notes off is a change; back on is the default again", () => {
    const off = withSwitch(SETTING_DEFAULTS.personal, { setting: "notes" }, false);
    expect(row(facts(), off, "notes").isDefault).toBe(false);
    const on = withSwitch(off, { setting: "notes" }, true);
    expect(on).toEqual(SETTING_DEFAULTS.personal);
  });

  test("a source off takes its dependants with it, and on brings back what it needs", () => {
    const off = withSwitch(
      SETTING_DEFAULTS.personal,
      { setting: "source", id: "cohort-records" },
      false,
    );
    expect(off.disabledSources).toEqual([
      "cohort-records",
      "cohort-analytics",
      "ark-genome",
      "vcf-variants",
      "imported-data",
    ]);
    const on = withSwitch(off, { setting: "source", id: "cohort-analytics" }, true);
    expect(on.disabledSources).toEqual(["ark-genome", "vcf-variants", "imported-data"]);
  });
});

describe("rows this server cannot use", () => {
  const unusable = facts({
    localOnly: true,
    availability: {
      ...allAvailable,
      "imported-data": { available: false, note: "Personal mode and a local model only" },
    },
  });

  test("say Unavailable and why, instead of a default badge", () => {
    expect(
      rows(unusable, SETTING_DEFAULTS.personal).flatMap((item) =>
        item.unavailable === null ? [] : [[item.key, item.unavailable]],
      ),
    ).toEqual([
      ["source-imported-data", "Personal mode and a local model only"],
      [
        "live-pubmed",
        "Off on this server: local-only mode sends nothing to public databases.",
      ],
      [
        "live-ensembl",
        "Off on this server: local-only mode sends nothing to public databases.",
      ],
    ]);
  });

  test("are left out of the summary, whatever is stored for them", () => {
    const state = {
      ...SETTING_DEFAULTS.personal,
      // Imported data stored on, on a server that cannot use it.
      disabledSources: ["ark-genome", "vcf-variants"] as const,
    };
    expect(row(unusable, state, "source-imported-data").isDefault).toBe(false);
    expect(changedFromDefault(settingsSections(unusable, state))).toBe(0);
  });

  test("a usable choice away from its default is still counted", () => {
    const state = { ...SETTING_DEFAULTS.personal, notesOn: false };
    expect(changedFromDefault(settingsSections(unusable, state))).toBe(1);
  });

  test("signing out locks switches but does not make them unavailable", () => {
    expect(
      rows(facts({ signedIn: false }), SETTING_DEFAULTS.personal).filter(
        (item) => item.unavailable !== null,
      ),
    ).toEqual([]);
  });
});

describe("personal-data sources", () => {
  test("start off and read as the safe default", () => {
    for (const id of ["ark-genome", "vcf-variants", "imported-data"] as const) {
      const item = row(facts(), SETTING_DEFAULTS.personal, `source-${id}`);
      expect([
        item.safeDefault,
        item.isDefault,
        item.control.kind === "switch" && item.control.on,
      ]).toEqual(["Off", true, false]);
    }
  });

  test("turned on, one reads as changed", () => {
    const state = withSwitch(
      SETTING_DEFAULTS.personal,
      { setting: "source", id: "vcf-variants" },
      true,
    );
    expect(state.disabledSources).toEqual(["ark-genome", "imported-data"]);
    expect(row(facts(), state, "source-vcf-variants").isDefault).toBe(false);
    expect(changedFromDefault(settingsSections(facts(), state))).toBe(1);
  });
});
