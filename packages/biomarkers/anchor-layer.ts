/**
 * The Anchor biomarker catalogue, read from the pinned open-twin artefact
 * (`@open-twin/anchor-layer`, see docs/open-twin-pins.md and docs/biomarkers.md).
 *
 * Only the package's JSON export is imported: its loader reads the file with
 * `node:fs`, and this module has to work in the browser too. The guard below
 * fails fast on a shape it does not know, so a pin bump that changes the
 * artefact breaks the tests instead of quietly showing a wrong catalogue.
 *
 * Two upstream rules are kept here rather than left to callers:
 * - interpretive bands are never read as reference intervals (open-twin D-c);
 * - a marker with a BLOCKING flag (LOINC property vs unit, open-twin D11) marks
 *   its intervals `blocked`, so no position is ever computed against them.
 *
 * `system_id` and `region_ids` come from Anchor as they are (open-twin D12/D14).
 */
import raw from "@open-twin/anchor-layer/data/anchor-layer.v1.json";

import { isSystemId, type SystemId } from "@/packages/anatomy/systems";

export const ANCHOR_SCHEMA_VERSION = "anchor-layer.v1";

export const ANCHOR_TIERS = [
  "core_tier1",
  "core_tier2",
  "core_tier1_decomposed",
] as const;

export type AnchorTier = (typeof ANCHOR_TIERS)[number];

/** The 20 region ids the pinned artefact uses (Anchor `Region_Enum`). */
export const ANCHOR_REGION_IDS = [
  "adrenal",
  "biliary",
  "bone",
  "bone_marrow_blood",
  "electrolyte_balance",
  "gonads",
  "gut",
  "immune",
  "kidney",
  "lipid_transport",
  "liver",
  "metabolic_glycemic",
  "micronutrient_status",
  "parathyroid",
  "pituitary",
  "prostate",
  "skeletal_muscle",
  "systemic_inflammation",
  "thyroid",
  "vasculature",
] as const;

export type AnchorRegionId = (typeof ANCHOR_REGION_IDS)[number];

export type Biomarker = Readonly<{
  id: string;
  nameDe: string;
  loincCode: string;
  loincDisplay: string;
  tier: AnchorTier;
  /** The unit Anchor reports the marker in, as UCUM. */
  unitUcum: string;
  /** The unit as the source workbook wrote it (`pmol/l`). */
  unitSource: string;
  systemId: SystemId;
  regionIds: readonly AnchorRegionId[];
  /** Anchor's own organ wording, e.g. "Cardiometabolic, Hepatic". */
  organMappingSource: string;
  /** `none`, or the workbook flag text (`BLOCKING: …`, `NOTE: …`, `OPEN: …`). */
  flag: string;
  blocked: boolean;
}>;

export type ReferenceInterval = Readonly<{
  id: string;
  biomarkerId: string;
  issuer: string | null;
  sourceUrl: string | null;
  retrievedAt: string | null;
  /** Anchor's population key, e.g. `age_>18J_male` (see population.ts). */
  population: string;
  low: number | null;
  high: number | null;
  unitUcum: string | null;
  referenceRangeText: string | null;
  /** Copied from the marker: a BLOCKING flag means no position is shown. */
  blocked: boolean;
}>;

export type AnchorLayer = Readonly<{
  schemaVersion: typeof ANCHOR_SCHEMA_VERSION;
  sourceFile: string;
  sourceSha256: string;
  biomarkers: readonly Biomarker[];
  referenceIntervals: readonly ReferenceInterval[];
}>;

type JsonRecord = Readonly<Record<string, unknown>>;

const fail = (message: string): never => {
  throw new Error(`anchor-layer: ${message}`);
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown, where: string): JsonRecord =>
  isRecord(value) ? value : fail(`${where} is not an object`);

const list = (value: unknown, where: string): readonly unknown[] =>
  Array.isArray(value) ? value : fail(`${where} is not an array`);

const text = (value: unknown, where: string): string =>
  typeof value === "string" ? value : fail(`${where} is not a string`);

const textOrNull = (value: unknown, where: string): string | null =>
  value === null ? null : text(value, where);

const numberOrNull = (value: unknown, where: string): number | null =>
  value === null
    ? null
    : typeof value === "number" && Number.isFinite(value)
      ? value
      : fail(`${where} is not a finite number`);

const isTier = (value: string): value is AnchorTier =>
  (ANCHOR_TIERS as readonly string[]).includes(value);

const isRegionId = (value: string): value is AnchorRegionId =>
  (ANCHOR_REGION_IDS as readonly string[]).includes(value);

const parseBiomarker = (value: unknown, index: number): Biomarker => {
  const where = `biomarkers[${index}]`;
  const row = record(value, where);
  const id = text(row.biomarker_id, `${where}.biomarker_id`);
  const tier = text(row.tier, `${id}.tier`);
  const systemId = text(row.system_id, `${id}.system_id`);
  const flag = text(row.blocking_flags, `${id}.blocking_flags`);
  const regionIds = list(row.region_ids, `${id}.region_ids`).map((region) => {
    const regionId = text(region, `${id}.region_ids`);
    return isRegionId(regionId)
      ? regionId
      : fail(`${id} has unknown region "${regionId}"`);
  });
  return {
    id,
    nameDe: text(row.name_de, `${id}.name_de`),
    loincCode: text(row.loinc_code, `${id}.loinc_code`),
    loincDisplay: text(row.loinc_display, `${id}.loinc_display`),
    tier: isTier(tier) ? tier : fail(`${id} has unknown tier "${tier}"`),
    unitUcum: text(row.unit_ucum, `${id}.unit_ucum`),
    unitSource: text(row.unit_source, `${id}.unit_source`),
    systemId: isSystemId(systemId)
      ? systemId
      : fail(`${id} has unknown system "${systemId}"`),
    regionIds,
    organMappingSource: text(row.organ_mapping_source, `${id}.organ_mapping_source`),
    flag,
    blocked: flag.startsWith("BLOCKING"),
  };
};

const parseInterval = (
  value: unknown,
  index: number,
  byId: ReadonlyMap<string, Biomarker>,
): ReferenceInterval => {
  const where = `reference_intervals[${index}]`;
  const row = record(value, where);
  const id = text(row.interval_id, `${where}.interval_id`);
  if (row.record_kind !== "reference_interval") {
    fail(`${id} is not a reference_interval record`);
  }
  const biomarkerId = text(row.biomarker_id, `${id}.biomarker_id`);
  const marker = byId.get(biomarkerId) ?? fail(`${id} points at unknown ${biomarkerId}`);
  return {
    id,
    biomarkerId,
    issuer: textOrNull(row.issuer, `${id}.issuer`),
    sourceUrl: textOrNull(row.source_url, `${id}.source_url`),
    retrievedAt: textOrNull(row.retrieved_at, `${id}.retrieved_at`),
    population: text(row.population, `${id}.population`),
    low: numberOrNull(row.low, `${id}.low`),
    high: numberOrNull(row.high, `${id}.high`),
    unitUcum: textOrNull(row.unit_ucum, `${id}.unit_ucum`),
    referenceRangeText: textOrNull(
      row.reference_range_text,
      `${id}.reference_range_text`,
    ),
    blocked: marker.blocked,
  };
};

/** Shape-check the artefact. `interpretive_bands` is deliberately never read (D-c). */
export const parseAnchorLayer = (json: unknown): AnchorLayer => {
  const root = record(json, "artefact");
  if (root.schema_version !== ANCHOR_SCHEMA_VERSION) {
    fail(
      `expected schema_version ${ANCHOR_SCHEMA_VERSION}, got ${String(root.schema_version)}`,
    );
  }
  const biomarkers = list(root.biomarkers, "biomarkers").map(parseBiomarker);
  const byId = new Map(biomarkers.map((marker) => [marker.id, marker]));
  if (byId.size !== biomarkers.length) fail("duplicate biomarker_id");
  return {
    schemaVersion: ANCHOR_SCHEMA_VERSION,
    sourceFile: text(root.source_file, "source_file"),
    sourceSha256: text(root.compiled_at_source_sha256, "compiled_at_source_sha256"),
    biomarkers,
    referenceIntervals: list(root.reference_intervals, "reference_intervals").map(
      (row, index) => parseInterval(row, index, byId),
    ),
  };
};

/** The pinned catalogue, parsed once on first import. */
export const anchorLayer: AnchorLayer = parseAnchorLayer(raw);
