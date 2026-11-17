import { isHiddenGroup, normaliseGroup } from "./hra-groups";

/**
 * The HRA organ-group keys on each donor atlas, exactly as their meshes'
 * `anatomical_structure_of` extra writes them. Read from `hra-m.ao.glb` (male)
 * and `hra.ao.glb` (female) at `ATLAS_GROUP_KEYS_READ_FROM`; a new atlas file
 * in `manifest.ts` means reading them again, and a test fails until then. The group key, not the node name, is the handle a
 * viewer can rely on: a loader rewrites node names (`.` and `/` go), extras
 * stay as written.
 */

export const TWIN_DONORS = ["male", "female"] as const;
export type TwinDonor = (typeof TWIN_DONORS)[number];

/** The sha256 of each atlas file the keys below were read from. */
export const ATLAS_GROUP_KEYS_READ_FROM: Readonly<Record<TwinDonor, string>> = {
  male: "5d820f289a529ef6ee6d2a1158c867d33f25dceaf269eebbbcd46f85b602addc",
  female: "37468cf1180b0367a698d40eefd962df0b12a53c1ce74a29d8b70a8af5dc0eb1",
};

export const ATLAS_GROUP_KEYS: Readonly<Record<TwinDonor, readonly string[]>> = {
  male: [
    "#VHMSkinV1.2",
    "#VHMBrain",
    "#VHMDuctsGallbladder",
    "#VHMLeftPalatineTonsil",
    "#VHMRightPalatineTonsil",
    "#VHMGallbladder",
    "#VHMOmentum",
    "#VHMEpiploicAppendageOfTransverseColon",
    "#VHMRightRenalPelvis",
    "#VHMRightUreter",
    "#VHMLeftRenalPelvis",
    "#VHMLeftUreter",
    "#VHMAdipose",
    "#VHMSpinalCord",
    "#VHMAllenBrain",
    "#VHMNervesEye",
    "#VHMRightEye",
    "#VHMLeftEye",
    "#VHMMusclesLeftEye",
    "#VHMMusclesRightEye",
    "#VHMMusclesLeftKnee",
    "#VHMMusclesRightKnee",
    "#VHMMusclesLarynx",
    "#VHMProstate",
    "#VHMMouth",
    "#VHMLiver",
    "#VHMPancreas",
    "#VHMDuctsPancreas",
    "#VHMDuctsLiver",
    "#VHMSmallIntestine",
    "#VHMColon",
    "#VHMLeftKidney",
    "#VHMRightKidney",
    "#VHMUrinaryBladder",
    "#VHMHeart",
    "#VHMBloodVasculature",
    "#VHMLungV1.1",
    "#VHMLarynx",
    "#VHMTrachea",
    "#VHMMainBronchus",
    "#VHMSpleen",
    "#VHMLymphNode",
    "#VHMThymus",
    "#VHMPelvis",
    "#VHMLigamentsRightKnee",
    "#VHMRightKnee",
    "#VHMLigamentsLeftKnee",
    "#VHMLeftKnee",
    "#VHMVertebrae",
    "#VHMIntervertebralDisk",
  ],
  female: [
    "#VHFSkinV1.2",
    "#VHFBrain",
    "#VHFVagina",
    "#VHFLeftOvary",
    "#VHFRightOvary",
    "#VHFOmentum",
    "##VHFEpiploicAppendageOfTransverseColon",
    "#VHFGallbladderDucts",
    "#VHFLeftPalatineTonsil",
    "#VHFRightPalatineTonsil",
    "#VHFGallbladder",
    "#VHFRightRenalPelvis",
    "#VHFRightUreter",
    "#VHFLeftRenalPelvis",
    "#VHFLeftUreter",
    "#VHFSternum",
    "#VHFManubrium",
    "#VHFAdipose",
    "#VHFLeftMammaryGland",
    "#VHFRightMammaryGland",
    "#VHFRightEye",
    "#VHFLeftEye",
    "#VHFNervesRightEye",
    "#VHFNervesLeftEye",
    "#VHFAllenBrain",
    "#VHFSpinalCord",
    "#VHFMusclesLeftEye",
    "#VHFMusclesRightEye",
    "#VHFMusclesLeftKnee",
    "#VHFMusclesRightKnee",
    "#VHFPlacenta",
    "#VHFUterus",
    "#VHFRightFallopianTube",
    "#VHFLeftFallopianTube",
    "#VHFLigamentsUterusOvaries",
    "#VHFMouth",
    "#VHFLiver",
    "#VHFPancreas",
    "#VHFLiverDucts",
    "#VHFPancreasDucts",
    "#VHFSmallIntestine",
    "#VHFLargeIntestine",
    "#VHFLeftKidneyV1.1",
    "#VHFRightKidneyV1.1",
    "#VHFUrinaryBladder",
    "#VHFHeartV1.1",
    "#VHFBloodVasculature",
    "#VHFLungV1.2",
    "#VHFLarynx",
    "#VHFTrachea",
    "#VHFMainBronchus",
    "#VHFSpleenV1.1",
    "#VHFThymusV1.1",
    "#VHFLymphNode",
    "#VHFPelvis",
    "#VHFVertebrae",
    "#VHFIntervertebralDisk",
    "#VHFKneeLigamentsRight",
    "#VHFRightKnee",
    "#VHFKneeLigamentsLeft",
    "#VHFLeftKnee",
  ],
};

/**
 * The group keys on one donor's atlas that light for the given normalised
 * groups (`heart`, `kidney`), in atlas order: the same match the twin makes.
 * Empty where that atlas has no such mesh; a neighbour is never used instead.
 * Hidden groups (placenta) are never a target.
 */
export const target3d = (
  groups: readonly string[],
  donor: TwinDonor,
): readonly string[] => {
  const wanted = new Set(groups.map(normaliseGroup));
  return ATLAS_GROUP_KEYS[donor].filter(
    (key) => !isHiddenGroup(key) && wanted.has(normaliseGroup(key)),
  );
};
