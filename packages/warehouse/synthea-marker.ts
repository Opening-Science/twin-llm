const SYNTHEA_IDENTIFIER_SYSTEM = "https://github.com/synthetichealth/synthea";

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const patientOf = (bundle: unknown): Record<string, unknown> | undefined => {
  if (!isObject(bundle) || !Array.isArray(bundle.entry)) return undefined;
  for (const entry of bundle.entry) {
    if (isObject(entry) && isObject(entry.resource)) {
      if (entry.resource.resourceType === "Patient") return entry.resource;
    }
  }
  return undefined;
};

export const isFhirBundle = (value: unknown): boolean =>
  isObject(value) && value.resourceType === "Bundle";

/** True when the bundle's Patient carries Synthea's own identifier system. */
export const isSyntheaBundle = (bundle: unknown): boolean => {
  const identifiers = patientOf(bundle)?.identifier;
  return (
    Array.isArray(identifiers) &&
    identifiers.some(
      (identifier) =>
        isObject(identifier) && identifier.system === SYNTHEA_IDENTIFIER_SYSTEM,
    )
  );
};
