/**
 * Body systems an atlas mesh can belong to. The same closed set open-twin-xr
 * uses, so its system maps (BodyParts3D extras, the HRA group table) apply as is.
 */
export const SYSTEM_IDS = [
  "musculoskeletal",
  "cardiovascular",
  "respiratory",
  "nervous",
  "digestive",
  "metabolic",
  "endocrine",
  "reproductive",
  "integumentary",
] as const;

export type SystemId = (typeof SYSTEM_IDS)[number];

/** A mesh with no identifiable system stays "unassigned" rather than guessed. */
export type OrganSystem = SystemId | "unassigned";

export const isSystemId = (value: unknown): value is SystemId =>
  typeof value === "string" && (SYSTEM_IDS as readonly string[]).includes(value);
