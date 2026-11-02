import { z } from "zod";

import { GBD_PROFILE_TOOL } from "@/packages/gbd-local/constants";

/**
 * The fixed frame of a GBD profile answer (#417): a header with the profile's
 * title, its data source and when the estimates were imported, and a footer
 * with the attribution line and IHME's citation. The app draws it around the
 * model's narration, on screen and in the thread's PDF and Markdown exports,
 * so a small model that skips the headings or the attribution cannot leave
 * them out. `gbd_profile` puts it in its output as `frame`; the model never
 * sees it. Pure, so the browser and the server share it.
 */

export const gbdProfileFrameSchema = z.object({
  /** `Location profile: Switzerland, 2023`. */
  title: z.string().min(1),
  /** `IHME GBD 2023`. */
  source: z.string().min(1),
  /** Day of the latest import, `YYYY-MM-DD`; null when not recorded. */
  importedOn: z.string().nullable(),
  attribution: z.string().min(1),
  citation: z.string().min(1),
});

export type GbdProfileFrame = z.infer<typeof gbdProfileFrameSchema>;

type PartLike = Readonly<{ type: string; state?: string; output?: unknown }>;

const frameOfOutput = (output: unknown): GbdProfileFrame | null => {
  if (typeof output !== "object" || output === null || !("frame" in output)) return null;
  const parsed = gbdProfileFrameSchema.safeParse(output.frame);
  return parsed.success ? parsed.data : null;
};

/**
 * The frame of the first `gbd_profile` call in a message that returned a
 * profile, from its tool part while it streams and once it is stored; null
 * when there is none (a refusal has no frame).
 */
export const profileFrameOf = (parts: readonly PartLike[]): GbdProfileFrame | null => {
  for (const part of parts) {
    if (part.type !== `tool-${GBD_PROFILE_TOOL}` || part.state !== "output-available")
      continue;
    const frame = frameOfOutput(part.output);
    if (frame !== null) return frame;
  }
  return null;
};

/** `Source: IHME GBD 2023, imported 2026-11-01.` */
export const frameSourceLine = (frame: GbdProfileFrame): string =>
  `Source: ${frame.source}, ${
    frame.importedOn === null
      ? "import date not recorded"
      : `imported ${frame.importedOn}`
  }.`;

/** The header as Markdown lines, for the thread export. */
export const frameHeaderMarkdown = (frame: GbdProfileFrame): string[] => [
  `**${frame.title}**`,
  "",
  `_${frameSourceLine(frame)}_`,
  "",
];

/** The footer as Markdown lines, for the thread export. */
export const frameFooterMarkdown = (frame: GbdProfileFrame): string[] => [
  "",
  `_${frame.attribution}_`,
  "",
  `Citation: ${frame.citation}`,
];
