import { ATLAS_IDS, ATLASES, type AtlasId } from "@/packages/anatomy/manifest";

import {
  MALE_ATLAS_ON_FEMALE,
  FEMALE_ATLAS_ON_MALE,
  NO_FEMALE_ATLAS,
} from "./anatomy-copy";

/**
 * Which donor atlas goes with which body. BodyParts3D and HRA male have male
 * donors; HRA female (`hra-f`) is the only female one. A female body gets the
 * female atlas when it is installed; otherwise a male atlas shows and the
 * viewer says so, never silently. A body whose sex is not known (a BodyLoop
 * scan) keeps whatever atlas is chosen.
 */
export type BodySex = "female" | "male";

/** FHIR administrative gender as stored for synthetic subjects; only two map to an atlas. */
export const bodySexOf = (value: unknown): BodySex | null =>
  value === "female" || value === "male" ? value : null;

/** The installed atlas to show now: the current one if installed, else the first installed. */
export const preferredAtlas = (
  current: AtlasId,
  installed: Readonly<Record<AtlasId, boolean>> | null,
): AtlasId =>
  installed === null || installed[current]
    ? current
    : (ATLAS_IDS.find((id) => installed[id]) ?? current);

/** Atlases with this donor sex, the current one first when it matches. */
const matching = (sex: BodySex, current: AtlasId): readonly AtlasId[] => {
  const all = ATLAS_IDS.filter((id) => ATLASES[id].donor === sex);
  return all.includes(current) ? [current, ...all.filter((id) => id !== current)] : all;
};

/**
 * The atlas for a body: one whose donor matches the body's sex, the current
 * one if it already does; with none of those installed, any installed atlas.
 * Before the install status is known (`installed` null) the match is assumed.
 */
export const atlasForBody = (
  sex: BodySex | null,
  current: AtlasId,
  installed: Readonly<Record<AtlasId, boolean>> | null,
): AtlasId => {
  if (sex === null) return preferredAtlas(current, installed);
  const candidates = matching(sex, current);
  const found = candidates.find((id) => installed === null || installed[id]);
  return found ?? preferredAtlas(current, installed);
};

/**
 * What the viewer says when the atlas donor and the body differ, or null when
 * they match or the body's sex is not known.
 */
export const atlasSexNote = (
  sex: BodySex | null,
  atlasId: AtlasId,
  installed: Readonly<Record<AtlasId, boolean>> | null,
): string | null => {
  const donor = ATLASES[atlasId].donor;
  if (sex === null || donor === sex) return null;
  if (sex === "male") return FEMALE_ATLAS_ON_MALE;
  const femaleMissing = ATLAS_IDS.filter((id) => ATLASES[id].donor === "female").every(
    (id) => installed !== null && !installed[id],
  );
  return femaleMissing ? NO_FEMALE_ATLAS : MALE_ATLAS_ON_FEMALE;
};
