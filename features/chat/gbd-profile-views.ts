import { type ChatView, choroplethView, viewId } from "@/infrastructure/chat-view";
import type { LocationIndex } from "@/infrastructure/charts/choropleth/match-location";
import { GBD_ESTIMATE_TOOL } from "@/packages/gbd-local/constants";
import type { GbdProfile, ProfileSection } from "@/packages/gbd-local/profile";

import { gbdEstimateRows } from "./gbd-estimate-rows";
import { buildMapSpec, type MapBuilt } from "./map-view";

/**
 * The views of one `gbd_profile` (#403): a table of its sections and what
 * each holds, a table per section that has rows (a ranked list where the
 * section ranks), and the map. Every number is a tool row's own, rounded the
 * way the table shows it. Pure; the audit rows are the runner's.
 */

/** Years and rates to one decimal, counts whole: what a table cell shows. */
export const tableValue = (value: number, unit: string | null): number =>
  unit === "number" ? Math.round(value) : Math.round(value * 10) / 10;

const yearWindow = (years: readonly number[]) => {
  const first = years.length === 0 ? 0 : Math.min(...years);
  const last = years.length === 0 ? 0 : Math.max(...years);
  return { start: `${first}-01-01`, end: `${last}-12-31` };
};

const valueLabel = (unit: string | null): string =>
  unit === null ? "Value" : `Value (${unit})`;

const PROFILE_TITLES = { location: "Location profile", cause: "Cause profile" } as const;

/** `Location profile: Switzerland, 2023`. */
export const profileTitle = (profile: GbdProfile): string =>
  `${PROFILE_TITLES[profile.kind]}: ${profile.subject}${profile.year === null ? "" : `, ${profile.year}`}`;

const allAuditIds = (profile: GbdProfile): readonly string[] => [
  ...new Set(profile.sections.flatMap((entry) => entry.auditIds)),
];

/** Every section and whether it is shown; a missing one says what is not imported. */
export const overviewView = (profile: GbdProfile): ChatView | null => {
  const ids = allAuditIds(profile);
  if (ids.length === 0) return null;
  return {
    id: `${viewId(ids)}-profile`,
    kind: "table",
    title: profileTitle(profile),
    sourceAuditIds: [...ids],
    spec: {
      measure: `gbd_profile.${profile.kind}`,
      label: profileTitle(profile),
      unit: null,
      window: yearWindow(profile.year === null ? [] : [profile.year]),
      subject: null,
      columns: [
        { key: "section", label: "Section", format: "text" },
        { key: "status", label: "Status", format: "text" },
        { key: "note", label: "Note", format: "text" },
      ],
      rows: profile.sections.map((entry) => ({
        section: entry.title,
        status: entry.status === "shown" ? "Shown" : "Not imported",
        note: entry.note,
      })),
      total: profile.sections.length,
    },
  };
};

/** One section with rows as a table; a ranked section numbers its rows. */
export const sectionView = (entry: ProfileSection): ChatView | null => {
  if (entry.status !== "shown" || entry.auditIds.length === 0) return null;
  const numbers = [
    { key: "value", label: valueLabel(entry.unit), format: "number" as const },
    { key: "lower", label: "Lower (95% UI)", format: "number" as const },
    { key: "upper", label: "Upper (95% UI)", format: "number" as const },
  ];
  const round = (value: number | null) =>
    value === null ? null : tableValue(value, entry.unit);
  return {
    id: `${viewId(entry.auditIds)}-${entry.id}`,
    kind: "table",
    title: entry.title,
    sourceAuditIds: [...entry.auditIds],
    spec: {
      measure: `gbd_profile.${entry.id}`,
      label: entry.title,
      unit: entry.unit,
      window: yearWindow(entry.rows.map((row) => row.year)),
      subject: null,
      columns: [
        ...(entry.ranked
          ? [{ key: "rank", label: "Rank", format: "number" as const }]
          : []),
        { key: "label", label: entry.rowLabel, format: "text" },
        ...(entry.ranked
          ? []
          : [{ key: "year", label: "Year", format: "text" as const }]),
        ...numbers,
      ],
      rows: entry.rows.map((row, index) => ({
        ...(entry.ranked ? { rank: index + 1 } : { year: String(row.year) }),
        label: row.label,
        value: round(row.value),
        lower: round(row.lower),
        upper: round(row.upper),
      })),
      total: entry.rows.length,
    },
  };
};

/**
 * The map's spec, or null when the profile has no map rows or none matches a
 * boundary. Every imported country is the world; units inside one country
 * are its states; anything else is the place and its neighbours.
 */
export const profileMapSpec = (
  index: LocationIndex,
  profile: GbdProfile,
): MapBuilt | null => {
  if (profile.map === null) return null;
  const rows = gbdEstimateRows(profile.map.result);
  if (rows === null) return null;
  const states = rows.some((row) => row.level === "subnational");
  const built = buildMapSpec(
    index,
    [{ tool: GBD_ESTIMATE_TOOL, callId: "gbd_profile.map", rows }],
    {
      level: states ? "country" : profile.map.world ? "world" : "region",
      country: null,
    },
  );
  return "code" in built ? null : built;
};

/**
 * The profile's views in reading order: its sections table, then each shown
 * section, the map in the map section's place. `mapAuditIds` are the map's
 * own audit rows; without them no map is drawn. `allowed` keeps only the
 * kinds the skill lists.
 */
export const profileViews = (
  profile: GbdProfile,
  map: Readonly<{ built: MapBuilt; auditIds: readonly string[] }> | null,
  allowed?: readonly string[],
): readonly ChatView[] => {
  const views = [
    overviewView(profile),
    ...profile.sections.map((entry) =>
      entry.id === "map"
        ? map === null || map.auditIds.length === 0
          ? null
          : choroplethView({
              spec: map.built.spec,
              place: map.built.place,
              sourceAuditIds: map.auditIds,
            })
        : sectionView(entry),
    ),
  ];
  return views.filter(
    (view): view is ChatView =>
      view !== null && (allowed === undefined || allowed.includes(view.kind)),
  );
};

/** Rows of a section the model reads; the tables and the map show all. */
const MODEL_ROWS = 10;

/**
 * What the model reads of a profile: each section's title, status, note and
 * its first rows rounded as the tables show them, and how many views were
 * drawn. It writes the prose; the numbers are these.
 */
export const profileModelNote = (profile: GbdProfile, views: readonly ChatView[]) => ({
  attribution: profile.attribution,
  profile: profileTitle(profile),
  views_drawn: views.length,
  sections: profile.sections.map((entry) => ({
    title: entry.title,
    status: entry.status === "shown" ? "shown" : "not imported",
    ...(entry.note === null ? {} : { note: entry.note }),
    ...(entry.status === "shown"
      ? {
          unit: entry.unit,
          rows: entry.rows.slice(0, MODEL_ROWS).map((row) => ({
            [entry.rowLabel.toLowerCase()]: row.label,
            year: row.year,
            value: tableValue(row.value, entry.unit),
          })),
          ...(entry.rows.length > MODEL_ROWS ? { rows_total: entry.rows.length } : {}),
        }
      : {}),
  })),
});
