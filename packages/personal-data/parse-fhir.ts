import { isValidUcum, normaliseBundle } from "@open-twin/fhir-r4";

import { mapConditions, mapMedicationRequests } from "@/packages/warehouse/map-clinical";
import {
  mapObservations,
  type MappedObservation,
} from "@/packages/warehouse/map-observation";

import { EFFECTIVE_TIME_REASONS, parseEffectiveTime } from "./effective-time";
import { MAX_ROWS } from "./limits";
import type { ClinicalDraft, ObservationDraft, ParsedImport, Unmapped } from "./types";

/**
 * A FHIR R4 file: a Bundle, one resource, or NDJSON (one resource per line,
 * as a bulk export writes it).
 *
 * The bundle first goes through open-twin's `normaliseBundle`, the same
 * structural gate the warehouse uses; a bundle it refuses is refused here
 * with its rule. Rows are then read from the file's own resources with the
 * warehouse mappers (`mapObservations`, `mapConditions`,
 * `mapMedicationRequests`), so the stored source reference is the file's id,
 * not a normalised one. Nothing is written to the warehouse; the caller
 * stores the drafts in the personal tables.
 *
 * Kept: Observations with a number, a unit and a date (blood pressure panel
 * components become their own rows, as in the warehouse), Conditions and
 * MedicationRequests. A unit that is not UCUM is kept as written and marked.
 * Reported: numbers without a unit or date, text and coded answers. Not
 * read at all: the Patient (name, identifiers, birth date) and every other
 * resource type, which the review counts.
 */

const LOINC = "http://loinc.org";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

const refuse = (code: string, message: string): ParsedImport => ({
  ok: false,
  refusal: { code, message },
});

/** JSON, or NDJSON when the whole text is not one JSON value. */
const readJson = (input: string): readonly unknown[] | null => {
  try {
    return [JSON.parse(input) as unknown];
  } catch {
    const lines = input.split(/\r?\n/).filter((line) => line.trim() !== "");
    try {
      return lines.length > 1 ? lines.map((line) => JSON.parse(line) as unknown) : null;
    } catch {
      return null;
    }
  }
};

const toBundle = (values: readonly unknown[]): Json | null => {
  if (values.length === 1 && isObject(values[0]) && values[0].resourceType === "Bundle") {
    return values[0];
  }
  if (
    !values.every((value) => isObject(value) && typeof value.resourceType === "string")
  ) {
    return null;
  }
  return {
    resourceType: "Bundle",
    type: "collection",
    entry: values.map((resource) => ({ resource })),
  };
};

const resourcesOf = (bundle: Json): readonly Json[] =>
  (Array.isArray(bundle.entry) ? bundle.entry : []).flatMap((entry) =>
    isObject(entry) && isObject(entry.resource) ? [entry.resource] : [],
  );

const codingsOf = (coded: Json): readonly Json[] => {
  const concept = isObject(coded.code) ? coded.code : {};
  return (Array.isArray(concept.coding) ? concept.coding : []).filter(isObject);
};

/**
 * The component a mapped row came from (`<id>#<loinc>` or `<id>#<loinc>/<n>`,
 * as `mapObservations` numbers them), or null for the resource's own value.
 */
const componentOf = (resource: Json, fhirId: string): Json | null => {
  const hash = fhirId.indexOf("#");
  if (hash === -1) return null;
  const [code, nth] = fhirId.slice(hash + 1).split("/");
  const matching = (Array.isArray(resource.component) ? resource.component : [])
    .filter(isObject)
    .filter((component) =>
      codingsOf(component).some((item) => item.system === LOINC && item.code === code),
    );
  return matching[nth === undefined ? 0 : Number(nth) - 1] ?? null;
};

const quantityOf = (resource: Json, fhirId: string): Json | null => {
  const source = componentOf(resource, fhirId) ?? resource;
  return isObject(source.valueQuantity) ? source.valueQuantity : null;
};

type Coded = Pick<ObservationDraft, "codeSystem" | "code" | "display">;

/** LOINC when the file has it, else the first coding; the name falls back to `code.text`. */
const codedOf = (resource: Json, fhirId: string): Coded => {
  const source = componentOf(resource, fhirId) ?? resource;
  const codings = codingsOf(source);
  const coding = codings.find((item) => item.system === LOINC) ?? codings[0];
  const code = text(coding?.code);
  const label = isObject(source.code) ? text(source.code.text) : null;
  return {
    codeSystem: code === null ? null : text(coding?.system),
    code,
    display: text(coding?.display) ?? label ?? code ?? "(no name)",
  };
};

type ObservationOutcome =
  | Readonly<{ kind: "draft"; draft: ObservationDraft }>
  | Readonly<{ kind: "unmapped"; unmapped: Unmapped }>
  | Readonly<{ kind: "panel" }>;

const observationOutcome = (
  resource: Json,
  mapped: MappedObservation,
): ObservationOutcome => {
  const fhirId = mapped.kind === "missingUnit" ? mapped.fhirId : mapped.row.fhirId;
  const where = `Observation ${fhirId}`;
  const unmapped = (code: string, reason: string): ObservationOutcome => ({
    kind: "unmapped",
    unmapped: { where, code, reason },
  });

  if (mapped.kind === "nonNumeric") {
    switch (mapped.row.valueType) {
      case "components":
        return { kind: "panel" };
      case "Quantity":
        return unmapped("no-date", "has a number but no effectiveDateTime");
      case "integer":
        return unmapped("no-unit", "has a whole number without a unit");
      default:
        return isObject(resource.valueQuantity)
          ? unmapped("not-a-number", "has a Quantity without a number")
          : unmapped(
              "not-a-number",
              "has a text or coded answer; this version stores numbers only",
            );
    }
  }

  const quantity = quantityOf(resource, fhirId);
  const value = quantity?.value;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return unmapped("not-a-number", "has no numeric value");
  }
  const unit =
    mapped.kind === "numeric"
      ? mapped.row.unitUcum
      : (text(quantity?.unit) ?? text(quantity?.code));
  if (unit === null) return unmapped("no-unit", "has a number without a unit");

  const time = parseEffectiveTime(text(resource.effectiveDateTime));
  if (!time.ok)
    return unmapped(`date-${time.reason}`, EFFECTIVE_TIME_REASONS[time.reason]);

  const coded = codedOf(resource, fhirId);
  return {
    kind: "draft",
    draft: {
      ...coded,
      value,
      unit,
      unitUcum: mapped.kind === "numeric" || isValidUcum(unit),
      effectiveAt: time.time.at,
      effectivePrecision: time.time.precision,
      sourceRef: fhirId,
      note: null,
    },
  };
};

const toClinical = (entries: readonly unknown[]): readonly ClinicalDraft[] => [
  ...mapConditions(entries).map((row): ClinicalDraft => ({
    resourceType: "Condition",
    codeSystem: row.codeSystem === "" ? null : row.codeSystem,
    code: row.code === "" ? null : row.code,
    display: row.display,
    startAt: row.onsetAt,
    endAt: row.abatementAt,
    status: row.clinicalStatus,
    sourceRef: row.fhirId,
  })),
  ...mapMedicationRequests(entries).map((row): ClinicalDraft => ({
    resourceType: "MedicationRequest",
    codeSystem: row.codeSystem === "" ? null : row.codeSystem,
    code: row.code === "" ? null : row.code,
    display: row.display,
    startAt: row.authoredAt,
    endAt: null,
    status: row.status,
    sourceRef: row.fhirId,
  })),
];

const STORED_TYPES = new Set(["Observation", "Condition", "MedicationRequest"]);

const otherTypesNote = (resources: readonly Json[]): readonly string[] => {
  const counts = new Map<string, number>();
  for (const resource of resources) {
    const type = text(resource.resourceType) ?? "unknown";
    if (STORED_TYPES.has(type) || type === "Patient" || type === "Medication") continue;
    counts.set(type, (counts.get(type) ?? 0) + 1);
  }
  if (counts.size === 0) return [];
  const listed = [...counts.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type} ${count}`)
    .join(", ");
  return [`Resources of other types are not stored in this version: ${listed}.`];
};

export const parseFhir = (input: string): ParsedImport => {
  const values = readJson(input);
  if (values === null) return refuse("not-json", "The file is not JSON or NDJSON.");
  const bundle = toBundle(values);
  if (bundle === null) {
    return refuse("not-fhir", "The file is not a FHIR Bundle or FHIR resources.");
  }
  const resources = resourcesOf(bundle);
  if (resources.length === 0) return refuse("empty", "The bundle has no resources.");

  const normalised = normaliseBundle(bundle, {
    connector: { connector: "personal-import", version: "1" },
    subjectKey: "personal-import",
    bundleKey: "personal-import",
    timestamp: new Date(0).toISOString(),
    type: "collection",
    unresolvedUrnPolicy: "preserve",
  });
  if (!normalised.bundle) {
    const rule =
      normalised.issues.find(
        (issue) => issue.severity === "error" || issue.severity === "fatal",
      )?.rule ?? "normalise-rejected";
    return refuse(
      "fhir-invalid",
      `The bundle did not pass the FHIR R4 structure checks (rule ${rule}).`,
    );
  }

  const entries = resources.map((resource) => ({ resource }));
  const observationResults = resources
    .filter((resource) => resource.resourceType === "Observation")
    .flatMap((resource): ObservationOutcome[] => {
      if (text(resource.id) === null) {
        return [
          {
            kind: "unmapped",
            unmapped: { where: "Observation", code: "no-id", reason: "has no id" },
          },
        ];
      }
      return mapObservations(resource).map((mapped) =>
        observationOutcome(resource, mapped),
      );
    });
  const observations = observationResults.flatMap((outcome) =>
    outcome.kind === "draft" ? [outcome.draft] : [],
  );
  if (observations.length > MAX_ROWS) {
    return refuse(
      "too-many-rows",
      `The file has ${observations.length} numbers; the limit is ${MAX_ROWS}.`,
    );
  }
  const unmapped = observationResults.flatMap((outcome) =>
    outcome.kind === "unmapped" ? [outcome.unmapped] : [],
  );
  const hasPatient = resources.some((resource) => resource.resourceType === "Patient");
  return {
    ok: true,
    kind: "fhir",
    observations,
    clinical: toClinical(entries),
    unmapped,
    notes: [
      ...(hasPatient
        ? [
            "The Patient resource is not stored: no name, identifier or birth date is kept.",
          ]
        : []),
      ...otherTypesNote(resources),
    ],
  };
};
