import "server-only";

import { type JSONValue, tool } from "ai";

import type { ChatView } from "@/infrastructure/chat-view";
import type { GbdProfileFrame } from "@/infrastructure/gbd-profile-frame";
import { LOCATION_INDEX } from "@/infrastructure/charts/choropleth/match-location";
import { recordGbdRows } from "@/packages/gbd-mcp/collector";
import {
  GBD_PROFILE_MAP_AUDIT_TOOL,
  GBD_PROFILE_TOOL,
} from "@/packages/gbd-local/constants";
import { findImportedName, resolveGbdPlace } from "@/packages/gbd-local/estimate-rows";
import { gbdLocationById } from "@/packages/gbd-local/locations";
import { gbdPanelRows, unseenPanelRows } from "@/packages/gbd-local/panel-rows";
import {
  assembleCauseProfile,
  assembleLocationProfile,
  causeAge,
  causeBySexInputs,
  causeHighestInput,
  causeRateInputs,
  causeTrendInputs,
  FALLBACK_YEAR,
  firstFound,
  type GbdProfile,
  isEstimate,
  latestYear,
  locationHeadlineInputs,
  mapInputs,
  type ProfileCall,
  type ProfilePlace,
  rankableCauses,
  unknownCauseNote,
} from "@/packages/gbd-local/profile";
import {
  type GbdEstimatePorts,
  runGbdEstimate,
} from "@/packages/query-tools/gbd-estimate";
import type { GbdEstimateInput } from "@/packages/query-tools/gbd-estimate-schema";
import {
  GBD_PROFILE_TOOL_DEFINITION,
  type GbdProfileInput,
  gbdProfileInput,
} from "@/packages/query-tools/gbd-profile-schema";
import {
  GBD_NOT_IMPORTED,
  gbdAmbiguousLocation,
  type GbdRefusal,
  gbdUnknownLocation,
} from "@/packages/query-tools/gbd-refusals";
import { modelInputSchema } from "@/packages/query-tools/model-schema";
import type { SessionScope } from "@/packages/query-tools/scope";

import {
  profileFrame,
  profileMapSpec,
  profileModelNote,
  profileViews,
} from "./gbd-profile-views";

/**
 * `gbd_profile` (#403): runs a profile's fixed sequence of `gbd_estimate`
 * calls, each through `runGbdEstimate` and so each audited as
 * `gbd_estimate`, assembles the sections (`packages/gbd-local/profile.ts`)
 * and draws them (`gbd-profile-views.ts`). The browser gets the views as
 * `data-view` parts and the header and footer as `frame` (#417); the model
 * gets the sections, never more numbers than the rows hold.
 */

export type GbdProfileOutput = GbdProfile &
  Readonly<{ views: readonly ChatView[]; frame: GbdProfileFrame }>;

export type GbdProfileDeps = Readonly<{
  scope: SessionScope;
  ports: GbdEstimatePorts;
  /** View kinds the turn may draw (a skill's `views`); left out, every kind. */
  views?: readonly string[];
}>;

/** One profile run: its deps and the panel rows it already recorded. */
type Run = GbdProfileDeps & Readonly<{ panelSeen: Set<string> }>;

const seqOf = (event: unknown): string | null =>
  typeof event === "object" &&
  event !== null &&
  "seq" in event &&
  (typeof event.seq === "bigint" || typeof event.seq === "number")
    ? String(event.seq)
    : null;

/** One audited `gbd_estimate` call, with the `seq` of its audit row. */
const call = async (deps: Run, input: GbdEstimateInput): Promise<ProfileCall> => {
  const auditIds: string[] = [];
  const result = await runGbdEstimate(deps.scope, input, {
    ...deps.ports,
    appendAudit: async (row) => {
      const event = await deps.ports.appendAudit(row);
      const seq = seqOf(event);
      if (seq !== null) auditIds.push(seq);
      return event;
    },
  });
  if (isEstimate(result)) {
    recordGbdRows(
      deps.scope.sessionId,
      unseenPanelRows(deps.panelSeen, gbdPanelRows(result)),
    );
  }
  return { input, result, auditIds };
};

/** Tries each input in order and stops at the first with rows. */
const firstWithRows = async (
  deps: Run,
  inputs: readonly GbdEstimateInput[],
): Promise<ProfileCall | null> => {
  const made: ProfileCall[] = [];
  for (const input of inputs) {
    const done = await call(deps, input);
    made.push(done);
    if (isEstimate(done.result)) break;
  }
  return firstFound(made);
};

const runLocation = async (
  deps: Run,
  input: GbdProfileInput,
  place: ProfilePlace,
): Promise<GbdProfile> => {
  const catalog = await deps.ports.catalog();
  const headline = locationHeadlineInputs(place);
  const hale = await call(deps, headline.hale);
  const lifeExpectancy = await call(deps, headline.lifeExpectancy);
  const year = latestYear([hale, lifeExpectancy], place.id);
  const asked = year ?? FALLBACK_YEAR;
  const causes = rankableCauses(catalog.causes);
  const dalys = await Promise.all(
    causeRateInputs("dalys", place.id, asked, causes.names).map((each) =>
      call(deps, each),
    ),
  );
  const map = await firstWithRows(deps, mapInputs(place, asked));
  const deaths =
    input.deaths === true
      ? await Promise.all(
          causeRateInputs("deaths", place.id, asked, causes.names).map((each) =>
            call(deps, each),
          ),
        )
      : undefined;
  return assembleLocationProfile({
    place,
    hale,
    lifeExpectancy,
    year,
    causes,
    dalys,
    map,
    ...(deaths === undefined ? {} : { deaths }),
  });
};

const runCause = async (
  deps: Run,
  input: GbdProfileInput,
  asked: string,
): Promise<GbdProfile> => {
  const catalog = await deps.ports.catalog();
  const known = findImportedName(asked, catalog.causes);
  const trendInputs = causeTrendInputs(known?.name ?? asked, "dalys");
  // Not imported: the first call is audited and refused; the rest would only be refused again.
  const trend = await firstWithRows(
    deps,
    known === null ? trendInputs.slice(0, 1) : trendInputs,
  );
  if (known === null) {
    return assembleCauseProfile({
      cause: asked,
      unknown: unknownCauseNote(asked, catalog.causes),
      trend,
      year: null,
      highest: null,
      bySex: [],
      ...(input.deaths === true ? { deaths: null } : {}),
    });
  }
  const cause = known.name;
  const year = latestYear(trend === null ? [] : [trend], null);
  const age = causeAge(trend === null ? [] : [trend]);
  const at = year ?? FALLBACK_YEAR;
  const highest = await call(deps, causeHighestInput(cause, age, at));
  const bySex = await Promise.all(
    causeBySexInputs(cause, age, at).map((each) => call(deps, each)),
  );
  const deaths =
    input.deaths === true
      ? await firstWithRows(deps, causeTrendInputs(cause, "deaths"))
      : undefined;
  return assembleCauseProfile({
    cause,
    trend,
    year,
    highest,
    bySex,
    ...(deaths === undefined ? {} : { deaths }),
  });
};

/** The place a location profile names, or the refusal `gbd_estimate` would give. */
const placeOf = async (
  ports: GbdEstimatePorts,
  query: string,
): Promise<ProfilePlace | GbdRefusal> => {
  const catalog = await ports.catalog();
  if (catalog.locations.length === 0) return GBD_NOT_IMPORTED;
  const resolved = resolveGbdPlace(query, catalog.locations);
  if (resolved.kind === "unknown") return gbdUnknownLocation(query);
  if (resolved.kind === "ambiguous") return gbdAmbiguousLocation(query, resolved.options);
  const entry = gbdLocationById(resolved.id);
  return {
    id: resolved.id,
    name:
      catalog.locations.find((location) => location.id === resolved.id)?.name ??
      entry?.name ??
      query,
    parentId: entry?.parentId ?? null,
  };
};

/** Appends the map's own audit row and returns its `seq`; no row, no map. */
const auditMap = async (
  deps: GbdProfileDeps,
  profile: GbdProfile,
): Promise<Parameters<typeof profileViews>[1]> => {
  const built = profileMapSpec(LOCATION_INDEX, profile);
  if (built === null || profile.map === null) return null;
  const event = await deps.ports.appendAudit({
    actor: deps.scope.actor,
    sessionId: deps.scope.sessionId,
    subjectRef: null,
    tool: GBD_PROFILE_MAP_AUDIT_TOOL,
    args: {
      level: built.spec.level,
      country: built.spec.country,
      calls: profile.map.auditIds,
    },
    result: {
      regions: built.spec.regions.map((region) => region.code),
      unmatched: built.spec.unmatched,
    },
    rowCount: built.spec.n,
  });
  const seq = seqOf(event);
  return seq === null ? null : { built, auditIds: [...profile.map.auditIds, seq] };
};

export const runGbdProfile = async (
  given: GbdProfileDeps,
  input: GbdProfileInput,
): Promise<GbdProfileOutput | GbdRefusal> => {
  const deps: Run = { ...given, panelSeen: new Set() };
  let profile: GbdProfile;
  if (input.kind === "location") {
    const place = await placeOf(deps.ports, input.location ?? "");
    if ("code" in place) return place;
    profile = await runLocation(deps, input, place);
  } else {
    const catalog = await deps.ports.catalog();
    if (catalog.locations.length === 0) return GBD_NOT_IMPORTED;
    profile = await runCause(deps, input, input.cause ?? "");
  }
  const map = await auditMap(deps, profile);
  const source =
    deps.ports.importSource === undefined
      ? null
      : await deps.ports.importSource().catch(() => null);
  return {
    ...profile,
    views: profileViews(profile, map, deps.views),
    frame: profileFrame(profile, source),
  };
};

const asJson = (value: unknown): JSONValue =>
  JSON.parse(JSON.stringify(value)) as JSONValue;

export const createGbdProfileTool = (deps: GbdProfileDeps) => ({
  [GBD_PROFILE_TOOL]: tool({
    description: GBD_PROFILE_TOOL_DEFINITION.description,
    inputSchema: modelInputSchema(gbdProfileInput),
    execute: (input) => runGbdProfile(deps, input),
    toModelOutput: ({ output }) => ({
      type: "json",
      value: asJson("code" in output ? output : profileModelNote(output, output.views)),
    }),
  }),
});
