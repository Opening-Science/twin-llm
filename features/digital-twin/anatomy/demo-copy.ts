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

export const DEMO_FIT_NOTE =
  "Reference anatomy from a donor atlas, scaled to the demo body's height and centred on its outline. The hips are not aligned.";
