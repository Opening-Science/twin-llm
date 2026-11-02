import { z } from "zod";

import { GBD_PROFILE_TOOL } from "@/packages/gbd-local/constants";

const name = z.string().regex(/^[^\n]{1,120}$/);

/**
 * `gbd_profile` (#403): one location or one cause, like IHME's GBD
 * profiles. A location profile names a place (GBD name, ISO code or id); a
 * cause profile names an IHME cause. `deaths` adds the deaths section, which
 * a profile leaves out unless the question asks for deaths.
 */
export const gbdProfileInput = z
  .object({
    kind: z.enum(["location", "cause"]),
    location: name.optional(),
    cause: name.optional(),
    deaths: z.boolean().optional(),
  })
  .strict()
  .refine(
    (input) =>
      input.kind === "location"
        ? input.location !== undefined && input.cause === undefined
        : input.cause !== undefined && input.location === undefined,
    { message: "kind location takes location; kind cause takes cause" },
  )
  .describe("A GBD 2023 profile from the estimates imported on this machine");

export type GbdProfileInput = z.infer<typeof gbdProfileInput>;

export const GBD_PROFILE_TOOL_DEFINITION = {
  name: GBD_PROFILE_TOOL,
  description:
    "One GBD 2023 profile from imported estimates, drawn as tables and a map. kind location: HALE, life expectancy, top causes of DALYs, region and world. kind cause: where highest, trend, by sex. deaths: true only if asked.",
  input: gbdProfileInput,
} as const;
