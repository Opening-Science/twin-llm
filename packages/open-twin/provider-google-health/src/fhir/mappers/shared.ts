/**
 * WHAT: Shared Google Health FHIR helpers — observation factory, quantities, time/period.
 * NOT:  Must not call vendor HTTP; must not invent LOINC/SNOMED — use allowlisted codes or vendor-local SYSTEMS.*.
 * GOVERNED BY: DECISIONS.md#d1; DECISIONS.md#d2; DECISIONS.md#d4
 * CORRECTNESS: UCUM gate for quantities; signed allowlist (verify/terminology-allowlist.json) for LOINC/SNOMED emitted via helpers.
 * GOTCHA: No live Google Health sandbox fixture yet — structural tests are not an oracle (BUILD-SUMMARY).
 */
import {
  type CodingInput,
  codeableConcept,
  createObservation,
  dataAbsentReason,
  deterministicId,
  LOINC_UNITS,
  optionalNumericComponent,
  quantity,
  SYSTEMS,
  type UcumUnit
} from '@open-twin/fhir-core';
import type { CodeableConcept, Extension, Identifier, Observation, Period, Quantity, Reference } from 'fhir/r4';
import type { health_v4 } from 'googleapis';

// This file used to re-export part of `@open-twin/fhir-core` so mappers could import
// everything from one place. That re-export could not be written cleanly: biome's
// `noBarrelFile` rejects `export ... from`, and the import-then-export workaround made
// tsup warn "imported but never used" on every build. The mappers now import shared
// names straight from `@open-twin/fhir-core`, as the other connectors already do —
// this file exports only what is genuinely local to Google Health.

/** Tags every emitted resource so a bundle is traceable to the release that produced it. */
export const CONNECTOR = { connector: 'google-health', version: '0.1.0' } as const;

/**
 * Units this connector needs that `@open-twin/fhir-core`'s shared table does not yet
 * carry. Declared in the same shape and funnelled through the same `quantity()` and
 * `numericComponent()` helpers so that adopting them upstream is an import change and
 * nothing else. Reported as a shared change rather than made unilaterally.
 */
export const GH_UCUM = {
  // MG_PER_DL was declared here as well as in the shared table, against this file's own
  // rule — two definitions of one unit, free to drift apart. Blood glucose now uses
  // `UCUM.MG_PER_DL`; see `glucoseCodeFor`, where the unit selects the LOINC code.
  MILLILITRE: { unit: 'milliliter', code: 'mL' },
  HERTZ: { unit: 'hertz', code: 'Hz' },
  // UCUM section 6: countable things are the unity carrying an annotation. A bare
  // `floors` is not a UCUM symbol and a validating server rejects it.
  FLOORS: { unit: 'floors', code: '{floors}' },
  STROKES: { unit: 'strokes', code: '{strokes}' },
  LEADS: { unit: 'leads', code: '{leads}' },
  WINDOWS: { unit: 'windows', code: '{windows}' },
  SEGMENTS: { unit: 'segments', code: '{segments}' }
} as const;

export type GoogleUnit = UcumUnit | (typeof GH_UCUM)[keyof typeof GH_UCUM];

/**
 * `quantity()` reads only `unit` and `code`, so widening the accepted unit table is
 * safe. The cast is confined to this one function and to `ghNumericComponent` below.
 */
export function ghQuantity(value: number | null | undefined, unit: GoogleUnit): Quantity | undefined {
  return quantity(value, unit as UcumUnit);
}

/**
 * A component whose value is absent is omitted rather than emitted with a
 * `dataAbsentReason`: at component level an absent optional metric carries no
 * information, and forty empty components per Observation is noise, not honesty. The
 * Observation's own `dataAbsentReason` is what states that the *measure* has no value.
 */
export function ghOptionalNumericComponent(
  coding: CodingInput | CodingInput[],
  value: number | null | undefined,
  unit: GoogleUnit
) {
  return optionalNumericComponent(coding, value, unit as UcumUnit);
}

/**
 * Decision D4: the unit for a LOINC code is looked up, never written next to the code
 * by hand. Before this, body height went out as `mm` from this connector and as `m`
 * from Oura under the identical code, so merging two bundles for one person produced
 * contradictory numbers.
 */
export function loincQuantity(loinc: string, value: number | null | undefined): Quantity | undefined {
  return quantity(value, requiredLoincUnit(loinc));
}

export function loincComponent(loinc: string, display: string, value: number | null | undefined) {
  return optionalNumericComponent({ system: SYSTEMS.LOINC, code: loinc, display }, value, requiredLoincUnit(loinc));
}

function requiredLoincUnit(loinc: string): UcumUnit {
  const unit = LOINC_UNITS[loinc];
  if (!unit) {
    throw new Error(`No shared unit is registered for LOINC ${loinc}; add it to LOINC_UNITS before emitting the code.`);
  }
  return unit;
}

/**
 * Google's int64 fields arrive as JSON strings (`beatsPerMinute: "72"`), so every one
 * of them goes through here. `Number('')` is 0 and `Number.isFinite(0)` is true, which
 * is why the empty and whitespace cases are rejected before coercion: an empty
 * `beatsPerMinute` must not publish a heart rate of zero.
 */
export function toNumber(value?: string | number | null): number | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function dateToIsoString(date?: health_v4.Schema$Date): string | undefined {
  if (!date?.year || !date.month || !date.day) {
    return undefined;
  }
  const month = String(date.month).padStart(2, '0');
  const day = String(date.day).padStart(2, '0');
  return `${date.year}-${month}-${day}`;
}

/** Google expresses a UTC offset as a protobuf Duration, e.g. `"7200s"` or `"-14400s"`. */
function offsetSeconds(utcOffset?: string | null): number | undefined {
  if (!utcOffset) return undefined;
  const match = /^(-?\d+(?:\.\d+)?)s$/.exec(utcOffset.trim());
  if (!match) return undefined;
  const seconds = Number(match[1]);
  // A UTC offset is a whole number of minutes; anything else cannot be rendered as a
  // FHIR dateTime offset, so the raw instant is kept rather than silently rounded.
  return Number.isFinite(seconds) && seconds % 60 === 0 ? seconds : undefined;
}

/**
 * Re-renders a UTC instant in the subject's own offset (decision D7).
 *
 * FHIR dateTime carries an offset precisely so that local-day grouping survives
 * transport. Dropping Google's `utcOffset` publishes a wearer at +02:00 entirely in
 * UTC, and their 01:00 local reading then lands on the previous day downstream.
 */
export function applyOffset(instant?: string | null, utcOffset?: string | null): string | undefined {
  if (!instant) return undefined;
  const seconds = offsetSeconds(utcOffset);
  if (seconds === undefined) return instant;
  const epochMs = Date.parse(instant);
  if (Number.isNaN(epochMs)) return instant;
  const shifted = new Date(epochMs + seconds * 1000).toISOString();
  const sign = seconds < 0 ? '-' : '+';
  const absolute = Math.abs(seconds);
  const hours = String(Math.floor(absolute / 3600)).padStart(2, '0');
  const minutes = String(Math.floor((absolute % 3600) / 60)).padStart(2, '0');
  return `${shifted.slice(0, -1)}${sign}${hours}:${minutes}`;
}

export function sampleTimeToDateTime(sampleTime?: health_v4.Schema$ObservationSampleTime): string | undefined {
  return applyOffset(sampleTime?.physicalTime, sampleTime?.utcOffset);
}

export function intervalToPeriod(
  interval?: health_v4.Schema$ObservationTimeInterval | health_v4.Schema$SessionTimeInterval
): Period | undefined {
  if (!interval?.startTime && !interval?.endTime) {
    return undefined;
  }
  const period: Period = {};
  const start = applyOffset(interval.startTime, interval.startUtcOffset);
  const end = applyOffset(interval.endTime, interval.endUtcOffset);
  if (start) period.start = start;
  if (end) period.end = end;
  return period;
}

/** Elapsed minutes across a Period, for the measures whose whole payload is a duration. */
export function periodMinutes(period?: Period): number | undefined {
  if (!period?.start || !period.end) return undefined;
  const start = Date.parse(period.start);
  const end = Date.parse(period.end);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return (end - start) / 60_000;
}

// Google reports every length in millimetres and every body mass in grams. The
// conversions live here rather than inline because two mapper files need each of
// them, and an inline `/ 1000` is exactly how a 5 km run came to publish as 5000000.
export function millimetresToMetres(value?: string | number | null): number | undefined {
  const millimetres = toNumber(value);
  return millimetres === undefined ? undefined : millimetres / 1000;
}

export function millimetresToCentimetres(value?: string | number | null): number | undefined {
  const millimetres = toNumber(value);
  return millimetres === undefined ? undefined : millimetres / 10;
}

export function gramsToKilograms(value?: string | number | null): number | undefined {
  const grams = toNumber(value);
  return grams === undefined ? undefined : grams / 1000;
}

/** Who the Observations are about, and the key their deterministic ids derive from (D1, D2). */
export interface SubjectContext {
  subject: Reference;
  /** The vendor's own user identifier. Never an email address or any other PII. */
  subjectKey: string;
}

/**
 * The DataPoint envelope, threaded to every mapper.
 *
 * `mapDataPointToFHIR` used to destructure the union member and pass that alone, so
 * `name` (the vendor's own record identifier) and `dataSource` (device, application,
 * platform, recordingMethod) were read from the wire and discarded by construction.
 */
export interface DataPointMeta extends SubjectContext {
  name?: string | null;
  dataSource?: health_v4.Schema$DataSource;
}

/** Foundation-controlled extension carrying the provenance FHIR R4 has no element for. */
export const DATA_SOURCE_EXTENSION = 'http://opentwin.ch/fhir/StructureDefinition/google-health-data-source';

export interface GoogleObservationInput {
  /** Distinguishes several resources derived from one record. Part of `Observation.id`. */
  measure: string;
  code: CodingInput | CodingInput[];
  codeText?: string;
  category?: { code: string; display: string } | Array<{ code: string; display: string }>;
  /**
   * A category with no equivalent in the HL7 `observation-category` value set. Emitted
   * under this connector's own code system rather than inventing a code in HL7's.
   */
  vendorCategory?: CodingInput;
  effectiveDateTime?: string;
  effectivePeriod?: Period;
  valueQuantity?: Quantity;
  valueString?: string;
  valueCodeableConcept?: CodeableConcept;
  /**
   * True when the measure's primary payload is a scalar. Such an Observation must
   * carry either a value or a `dataAbsentReason` — a coded, final Observation with
   * neither is an assertion the receiver cannot interpret, and missing is not zero.
   */
  expectsValue?: boolean;
  components?: Array<NonNullable<Observation['component']>[number] | undefined>;
  method?: CodeableConcept;
  device?: Reference;
  note?: string;
  profiles?: string[];
  /** Vendor identifiers carried in the record itself, in addition to the DataPoint name. */
  identifier?: Identifier[];
  hasMember?: Reference[];
}

function dataSourceExtension(dataSource?: health_v4.Schema$DataSource): Extension | undefined {
  if (!dataSource) return undefined;
  const parts: Extension[] = [];
  // `DERIVED` says the number was estimated rather than measured. Dropping it publishes
  // a modelled value as if a sensor had read it.
  if (dataSource.recordingMethod) parts.push({ url: 'recordingMethod', valueCode: dataSource.recordingMethod });
  if (dataSource.platform) parts.push({ url: 'platform', valueCode: dataSource.platform });
  if (dataSource.application?.packageName) {
    parts.push({ url: 'application', valueString: dataSource.application.packageName });
  }
  if (dataSource.device?.manufacturer) {
    parts.push({ url: 'deviceManufacturer', valueString: dataSource.device.manufacturer });
  }
  if (dataSource.device?.formFactor) parts.push({ url: 'deviceFormFactor', valueCode: dataSource.device.formFactor });
  return parts.length > 0 ? { url: DATA_SOURCE_EXTENSION, extension: parts } : undefined;
}

function effectiveKey(input: GoogleObservationInput): string {
  return input.effectiveDateTime ?? input.effectivePeriod?.start ?? input.effectivePeriod?.end ?? 'no-effective-time';
}

/**
 * Decision D2: the record's own address.
 *
 * `DataPoint.name` is the vendor's identifier and is used verbatim where Google
 * supplies one. It is documented as empty for most data types, so the fallback is the
 * natural key — measure plus effective time — which is stable across a re-sync of the
 * same window. A random UUID here would reintroduce the duplication it is meant to fix.
 */
function recordKey(input: GoogleObservationInput, meta: DataPointMeta): string {
  return meta.name ?? `${input.measure}|${effectiveKey(input)}`;
}

export function createGoogleObservation(input: GoogleObservationInput, meta: DataPointMeta): Observation {
  const record = recordKey(input, meta);
  const hasEffective = Boolean(input.effectiveDateTime ?? input.effectivePeriod?.start ?? input.effectivePeriod?.end);

  const identifiers: Identifier[] = [
    { system: SYSTEMS.GOOGLE_HEALTH_IDENTIFIER, value: record },
    ...(input.identifier ?? [])
  ];

  const observation = createObservation({
    id: deterministicId({
      connector: CONNECTOR.connector,
      subjectKey: meta.subjectKey,
      recordId: record,
      measure: input.measure
    }),
    identifier: identifiers,
    code: input.code,
    codeText: input.codeText,
    category: input.category,
    subject: meta.subject,
    effectiveDateTime: input.effectiveDateTime,
    effectivePeriod: input.effectivePeriod,
    valueQuantity: input.valueQuantity,
    valueString: input.valueString,
    valueCodeableConcept: input.valueCodeableConcept,
    dataAbsentReason: input.expectsValue ? dataAbsentReason() : undefined,
    components: input.components,
    method: input.method,
    device: input.device ?? deviceReference(meta.dataSource),
    note: input.note,
    // The vital-signs profiles require `effective[x]`. Declaring one on a record that
    // carries no time would turn a missing timestamp into a conformance failure.
    profiles: hasEffective ? input.profiles : undefined
  });

  if (input.vendorCategory) {
    observation.category = [...(observation.category ?? []), codeableConcept(input.vendorCategory)];
  }

  const extension = dataSourceExtension(meta.dataSource);
  if (extension) observation.extension = [extension];

  if (input.hasMember?.length) observation.hasMember = input.hasMember;

  return observation;
}

function deviceReference(dataSource?: health_v4.Schema$DataSource): Reference | undefined {
  const displayName = dataSource?.device?.displayName;
  return displayName ? { display: displayName } : undefined;
}

/** `urn:uuid:` reference to a sibling resource in the same bundle. */
export function bundleReference(id: string): Reference {
  return { reference: `urn:uuid:${id}` };
}
