import { describe, expect, test } from "bun:test";

import { toChatView } from "@/infrastructure/chat-view";
import type { AppendInput } from "@/packages/audit/append";
import { drainGbdTurn } from "@/packages/gbd-mcp/collector";
import {
  MADE_UP_CAUSE_CSV,
  MADE_UP_HALE_CSV,
} from "@/packages/gbd-local/made-up-results.test-helpers";
import { type GbdCsvRow, parseGbdResultsCsv } from "@/packages/gbd-local/results-csv";
import type { GbdCatalog, GbdEstimatePorts } from "@/packages/query-tools/gbd-estimate";
import { gbdProfileInput } from "@/packages/query-tools/gbd-profile-schema";
import type { SessionScope } from "@/packages/query-tools/scope";

import { type GbdProfileOutput, runGbdProfile } from "./gbd-profile-tool";

/**
 * `gbd_profile` (#403) over MADE-UP rows in the Results Tool layout (the
 * values are not IHME's): the fixed sequence of audited `gbd_estimate`
 * calls, the map's own audit row, and the views.
 */

const rowsOf = (text: string): readonly GbdCsvRow[] => {
  const parsed = parseGbdResultsCsv(text);
  if (!parsed.ok) throw new Error(parsed.error.code);
  return parsed.rows;
};

const STORED = [...rowsOf(MADE_UP_CAUSE_CSV), ...rowsOf(MADE_UP_HALE_CSV)];

const named = (pairs: readonly (readonly [number | null, string | null])[]) =>
  [
    ...new Map(
      pairs.flatMap(([id, name]) => (id === null || name === null ? [] : [[id, name]])),
    ),
  ]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id - b.id);

const fakePorts = (stored: readonly GbdCsvRow[] = STORED) => {
  const audits: AppendInput[] = [];
  const catalog = async (): Promise<GbdCatalog> => ({
    locations: named(stored.map((row) => [row.locationId, row.locationName])),
    causes: named(stored.map((row) => [row.causeId, row.causeName])),
    risks: [],
    ages: [...new Set(stored.map((row) => row.ageId))].sort((a, b) => a - b),
  });
  const ports: GbdEstimatePorts = {
    catalog,
    findEstimates: async (query) =>
      stored
        .filter(
          (row) =>
            row.measureId === query.measureId &&
            row.metricId === query.metricId &&
            row.sexId === query.sexId &&
            row.ageId === query.ageId &&
            query.years.includes(row.year) &&
            query.locationIds.includes(row.locationId) &&
            row.causeId === query.causeId &&
            row.reiId === query.reiId,
        )
        .slice(0, query.take)
        .map((row) => ({
          locationId: row.locationId,
          locationName: row.locationName,
          year: row.year,
          val: row.val,
          upper: row.upper,
          lower: row.lower,
        })),
    appendAudit: async (input) => {
      audits.push(input);
      return { seq: audits.length };
    },
  };
  return { ports, audits };
};

const scope: SessionScope = {
  actor: "local",
  sessionId: "profile-turn",
  mode: "personal",
};

const asProfile = (output: unknown): GbdProfileOutput => {
  if (typeof output !== "object" || output === null || !("sections" in output)) {
    throw new Error("not a profile");
  }
  return output as GbdProfileOutput;
};

describe("gbd_profile input", () => {
  test("is closed: a location profile names a place, a cause profile a cause", () => {
    const ok = (value: unknown) => gbdProfileInput.safeParse(value).success;
    expect(ok({ kind: "location", location: "CHE" })).toBe(true);
    expect(ok({ kind: "cause", cause: "Diabetes mellitus", deaths: true })).toBe(true);
    expect(ok({ kind: "location", cause: "Diabetes mellitus" })).toBe(false);
    expect(ok({ kind: "location", location: "CHE", cause: "Diabetes mellitus" })).toBe(
      false,
    );
    expect(ok({ kind: "cause" })).toBe(false);
    expect(ok({ kind: "location", location: "CHE", extra: 1 })).toBe(false);
  });
});

describe("a location profile", () => {
  test("runs the fixed sequence, each call audited as gbd_estimate with no subject", async () => {
    const { ports, audits } = fakePorts();
    const profile = asProfile(
      await runGbdProfile(
        { scope, ports },
        { kind: "location", location: "Switzerland" },
      ),
    );
    expect(audits.map((row) => row.tool)).toEqual([
      "gbd_estimate",
      "gbd_estimate",
      "gbd_estimate",
      "gbd_estimate",
      "gbd_estimate",
      "gbd_profile.map",
    ]);
    expect(audits.every((row) => row.subjectRef === null)).toBe(true);
    const asked = audits.slice(0, 5).map((row) => row.args as Record<string, unknown>);
    expect(asked.map((args) => [args.measure, args.cause ?? null])).toEqual([
      ["hale", null],
      ["life_expectancy", null],
      ["dalys", "Cardiovascular diseases"],
      ["hale", null],
      ["hale", null],
    ]);
    expect(asked[3]?.children_of).toBe("94");
    expect(asked[4]?.children_of).toBe("73");

    expect(profile.subject).toBe("Switzerland");
    expect(profile.year).toBe(2023);
    const byId = new Map(profile.sections.map((entry) => [entry.id, entry]));
    expect(byId.get("hale")?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Switzerland", 70.25],
    ]);
    expect(byId.get("hale")?.note).toBe("Not imported for Western Europe and Global.");
    expect(byId.get("life_expectancy")?.rows.map((row) => row.value)).toEqual([80.5]);
    expect(byId.get("top_dalys")?.status).toBe("not_imported");
    expect(byId.get("map")?.rows.map((row) => row.label)).toEqual([
      "Switzerland",
      "Germany",
    ]);
    expect(byId.has("top_deaths")).toBe(false);

    expect(profile.views.map((view) => view.kind)).toEqual([
      "table",
      "table",
      "table",
      "map.choropleth",
    ]);
    expect(profile.views.every((view) => toChatView(view) !== null)).toBe(true);
    const map = profile.views.at(-1);
    expect(map?.sourceAuditIds).toEqual(["5", "6"]);
    // Switzerland's HALE comes back for its section and for the map; the panel lists it once.
    const panel = drainGbdTurn(scope.sessionId).rows;
    expect(
      panel.filter((row) => row.location === "Switzerland" && row.measure === "hale"),
    ).toHaveLength(1);
    expect(panel.map((row) => row.location).sort()).toEqual([
      "Germany",
      "Switzerland",
      "Switzerland",
    ]);
  });

  test("deaths come only when asked, ranked by cause", async () => {
    const { ports } = fakePorts();
    const profile = asProfile(
      await runGbdProfile(
        { scope, ports },
        { kind: "location", location: "CHE", deaths: true },
      ),
    );
    const deaths = profile.sections.find((entry) => entry.id === "top_deaths");
    expect(deaths?.rows.map((row) => [row.label, row.value])).toEqual([
      ["Cardiovascular diseases", 98.25],
    ]);
    drainGbdTurn(scope.sessionId);
  });

  test("carries the app's header and footer from the import (#417)", async () => {
    const { ports } = fakePorts();
    const profile = asProfile(
      await runGbdProfile(
        {
          scope,
          ports: {
            ...ports,
            importSource: async () => ({
              importedOn: "2026-11-01",
              citation: "A made-up citation.",
            }),
          },
        },
        { kind: "location", location: "Switzerland" },
      ),
    );
    expect(profile.frame).toEqual({
      title: `Location profile: Switzerland, ${profile.year}`,
      source: "IHME GBD 2023",
      importedOn: "2026-11-01",
      attribution:
        "Population estimate (IHME GBD 2023), not a statement about this person.",
      citation: "A made-up citation.",
    });
  });

  test("a failed import read leaves the day unknown and the citation IHME's", async () => {
    const { ports } = fakePorts();
    const profile = asProfile(
      await runGbdProfile(
        {
          scope,
          ports: { ...ports, importSource: () => Promise.reject(new Error("down")) },
        },
        { kind: "location", location: "Switzerland" },
      ),
    );
    expect(profile.frame.importedOn).toBeNull();
    expect(profile.frame.citation).toStartWith(
      "Global Burden of Disease Collaborative Network.",
    );
  });

  test("an unknown place is refused before any estimate is read", async () => {
    const { ports, audits } = fakePorts();
    const output = await runGbdProfile(
      { scope, ports },
      { kind: "location", location: "Atlantis" },
    );
    expect(output).toMatchObject({ code: "GBD_UNKNOWN_LOCATION", query: "Atlantis" });
    expect(audits).toEqual([]);
  });

  test("nothing imported is refused", async () => {
    const { ports } = fakePorts([]);
    expect(
      await runGbdProfile({ scope, ports }, { kind: "cause", cause: "Neoplasms" }),
    ).toMatchObject({ code: "GBD_NOT_IMPORTED" });
  });
});

describe("a cause profile", () => {
  test("a cause the import does not hold: one refused call, every section says so", async () => {
    const { ports, audits } = fakePorts();
    const profile = asProfile(
      await runGbdProfile(
        { scope, ports },
        { kind: "cause", cause: "Diabetes mellitus" },
      ),
    );
    expect(audits.map((row) => [row.tool, row.rowCount])).toEqual([["gbd_estimate", 0]]);
    expect(new Set(profile.sections.map((entry) => entry.status))).toEqual(
      new Set(["not_imported"]),
    );
    expect(profile.sections[0]?.note).toBe(
      "Diabetes mellitus is not imported; imported causes: All causes, Cardiovascular diseases.",
    );
    expect(profile.views.map((view) => view.kind)).toEqual(["table"]);
  });

  test("an imported cause with no DALY rows says what is not imported", async () => {
    const { ports, audits } = fakePorts();
    const profile = asProfile(
      await runGbdProfile(
        { scope, ports },
        { kind: "cause", cause: "cardiovascular diseases", deaths: true },
      ),
    );
    expect(profile.subject).toBe("Cardiovascular diseases");
    // Trend (age-standardised, then all ages), highest, female, male, deaths (both ages).
    expect(audits.map((row) => (row.args as { measure: string }).measure)).toEqual([
      "dalys",
      "dalys",
      "dalys",
      "dalys",
      "dalys",
      "deaths",
      "deaths",
    ]);
    const deaths = profile.sections.find((entry) => entry.id === "deaths_trend");
    expect(deaths?.rows).toEqual([]);
    expect(profile.sections.find((entry) => entry.id === "highest")?.note).toBe(
      "Cardiovascular diseases DALY rates by country are not imported.",
    );
  });
});
