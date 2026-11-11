import { formatNumber } from "@/infrastructure/format-measure";
import { DEMO_BODIES, demoBodyIdFor } from "@/packages/anatomy/demo-bodies";

/**
 * Every user-facing string for the synthetic demo subject, in one place so
 * lint:claims checks them. The demo body is generated, and the copy says so
 * wherever it is shown.
 */
export type DemoSex = "male" | "female";

export const DEMO_SUBJECT_LABEL = "Demo (synthetic)";
export const DEMO_BODY_NOTE = "Synthetic demo body, not a person.";
export const DEMO_BODY_PICKER = "Body";
/**
 * The install step is in docs/anatomy.md. The page names a command only where a
 * missing local file is the sole cause (Walk/Idle without the rigged bodies,
 * motion-copy.ts); a load error can have other causes, so it names none.
 */
export const DEMO_LOAD_ERROR = "Could not load the demo body.";
/** API response, read by developers, so it may name the install command. */
export const DEMO_NOT_INSTALLED_API =
  "Demo body not installed. Run bun run anatomy:fetch.";
export const RIGGED_NOT_INSTALLED_API =
  "Rigged demo body not installed. Run bun run anatomy:fetch.";

const metres = (value: number): string => `${formatNumber(value, 2)} m`;

export const DEMO_SEX_LABEL: Readonly<Record<DemoSex, string>> = {
  male: `Male · ANNY adult · ${metres(DEMO_BODIES[demoBodyIdFor("male")].heightM)}`,
  female: `Female · ANNY adult · ${metres(DEMO_BODIES[demoBodyIdFor("female")].heightM)}`,
};

export const DEMO_TYPICAL_NOTE =
  "Body shape is synthetic. Organ positions and limb pose are typical, not measured.";

/**
 * The rigged demo body's legs are posed to the atlas's stance
 * (`packages/anatomy/stance.ts`): `DEMO_FIT_NOTE`. The static fallback body
 * has no skeleton and is not posed: `DEMO_FIT_NOTE_UNPOSED`.
 */
export const DEMO_FIT_NOTE =
  "Reference anatomy from a donor atlas, scaled to the demo body's height and centred on its outline. The demo body is posed to the atlas's stance, its feet over the atlas's feet. The hips are not aligned.";
export const DEMO_FIT_NOTE_UNPOSED =
  "Reference anatomy from a donor atlas, scaled to the demo body's height and centred on its outline. The hips are not aligned.";
/**
 * "Fit atlas to body" (#525's Blender fit): the atlas is refitted to the
 * rigged body at its bind pose, so the body stands unposed. The figures are
 * the measured ones in docs/anatomy.md, "Per-limb atlas fit".
 */
/** The segment fit (`packages/anatomy/segments.ts`), made in the browser. */
export const DEMO_SEGMENT_FIT_NOTE =
  "Reference anatomy from a donor atlas, fitted to the demo body part by part: head, neck, trunk, each arm and each leg are placed and scaled from the body's joints and outline, and move with it. The demo body stands unposed.";
export const DEMO_FITTED_NOTE =
  "Reference anatomy from a donor atlas, refitted to the demo body limb by limb in Blender: each thigh and shin, and each arm where the atlas has arm bones, is turned toward the body's knee and ankle, or elbow and wrist, keeping its length. Where the atlas has foot and hand bones, each foot and hand also turns to point the way the body's does, and each palm to face the same way. Ankles land within 1.2 cm; knees sit 3.5 to 7.6 cm low. The trunk and organs are only shifted to meet the hips. The demo body stands unposed.";
