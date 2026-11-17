import { isHiddenGroup, normaliseGroup } from "./hra-groups";

/**
 * The HRA organ-group keys on each donor atlas, exactly as their meshes'
 * `anatomical_structure_of` extra writes them. Read from `hra-m.ao.glb` (male)
 * and `hra.ao.glb` (female) at the sha256 in `manifest.ts`; a new atlas file
 * means reading them again. The group key, not the node name, is the handle a
 * viewer can rely on: a loader rewrites node names (`.` and `/` go), extras
 * stay as written.
 */

export const TWIN_DONORS = ["male", "female"] as const;
export type TwinDonor = (typeof TWIN_DONORS)[number];

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
