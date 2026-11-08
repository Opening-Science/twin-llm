// One FHIR subject per person across connectors (#476). Upstream mints the
// patient as `patientUuid(connector, subjectKey)`, so the same person gets one
// subject per connector and `@open-twin/aggregate` refuses to combine them. The
// connector stays in that id upstream; the host passes every builder this
// shared subject instead (each builder's `subject` option) and adds the Patient
// it points at. No server-only so tests can build a bundle from a fixture.
import { uuidv5 } from "@open-twin/fhir-core";
import type { Bundle, BundleEntry, FhirResource, Patient, Reference } from "fhir/r4";

/**
 * UUIDv5(open-twin namespace, "twin-llm/person"): the host's own namespace, so
 * a person's id can never equal a connector's `patientUuid`, and can be
 * recomputed rather than trusted.
 */
export const PERSON_NAMESPACE = uuidv5("twin-llm/person");

/** The person's id: from the host's subject key alone, never a connector or vendor id. */
export const personUuid = (subjectKey: string): string =>
  uuidv5(subjectKey, PERSON_NAMESPACE);

export const personSubject = (subjectKey: string): Reference => ({
  reference: `urn:uuid:${personUuid(subjectKey)}`,
});

const subjectsOf = (resource: FhirResource): readonly Reference[] => {
  const subject =
    "subject" in resource
      ? (resource.subject as Reference | Reference[] | undefined)
      : undefined;
  return Array.isArray(subject) ? subject : subject ? [subject] : [];
};

const resourcesOf = (bundle: Bundle): FhirResource[] =>
  (bundle.entry ?? [])
    .map((entry) => entry.resource as FhirResource | undefined)
    .filter((resource): resource is FhirResource => resource !== undefined);

/**
 * Puts the Patient the shared subject points at first in a connector's bundle,
 * so the bundle stays self-contained. It carries the connector's identifier
 * (`identifierSystem`, as upstream's `minimalPatient` does) and links any
 * Patient the connector built itself (Oura `personal_info`, still under its
 * per-connector id), so the connector stays visible. A bundle where nothing
 * refers to the person is returned as is: an empty sync asserts no one.
 */
export const withPersonPatient = (
  bundle: Bundle,
  options: { readonly subjectKey: string; readonly identifierSystem: string },
): Bundle => {
  const subject = personSubject(options.subjectKey).reference;
  const resources = resourcesOf(bundle);
  const referenced = resources.some((resource) =>
    subjectsOf(resource).some((entry) => entry.reference === subject),
  );
  const id = personUuid(options.subjectKey);
  if (!referenced || resources.some((r) => r.resourceType === "Patient" && r.id === id)) {
    return bundle;
  }

  const connectorPatients = (bundle.entry ?? []).filter(
    (entry) => entry.resource?.resourceType === "Patient" && entry.fullUrl,
  );
  const patient: Patient = {
    resourceType: "Patient",
    id,
    identifier: [{ system: options.identifierSystem, value: options.subjectKey }],
    ...(connectorPatients.length > 0
      ? {
          link: connectorPatients.map((entry) => ({
            other: { reference: entry.fullUrl },
            type: "seealso" as const,
          })),
        }
      : {}),
  };
  const entry: BundleEntry = { fullUrl: `urn:uuid:${id}`, resource: patient };
  return { ...bundle, entry: [entry, ...(bundle.entry ?? [])] };
};

/**
 * Each connector's bundle carries the person's Patient, so combining them
 * would carry it once per connector. This keeps one per id, in the first
 * bundle that has it, with every connector's identifiers and links.
 */
export const mergePersonPatients = (bundles: readonly Bundle[]): Bundle[] => {
  const merged = new Map<string, Patient>();
  for (const bundle of bundles) {
    for (const resource of resourcesOf(bundle)) {
      if (resource.resourceType !== "Patient" || !resource.id) continue;
      const seen = merged.get(resource.id);
      merged.set(
        resource.id,
        seen
          ? {
              ...seen,
              identifier: [...(seen.identifier ?? []), ...(resource.identifier ?? [])],
              ...(seen.link || resource.link
                ? { link: [...(seen.link ?? []), ...(resource.link ?? [])] }
                : {}),
            }
          : resource,
      );
    }
  }

  const placed = new Set<string>();
  return bundles.map((bundle) => ({
    ...bundle,
    entry: (bundle.entry ?? []).flatMap((entry) => {
      const resource = entry.resource as FhirResource | undefined;
      if (resource?.resourceType !== "Patient" || !resource.id) return [entry];
      if (placed.has(resource.id)) return [];
      placed.add(resource.id);
      return [{ ...entry, resource: merged.get(resource.id) ?? resource }];
    }),
  }));
};
