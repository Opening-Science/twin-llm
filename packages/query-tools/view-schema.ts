import { z } from "zod";

import { subjectRefSchema, windowSchema } from "./schemas";

/**
 * `show_view`: the model names a measure and a window, the server reads the
 * rows and draws them. It is in the chat's model-facing list but not in the
 * MCP manifest, since a view only means something inside the app.
 */

export const VIEW_KINDS = ["chart.timeseries"] as const;

export const showViewInput = z
  .object({
    kind: z.enum(VIEW_KINDS),
    measure: z
      .string()
      .min(1)
      .max(128)
      .describe("A LOINC code, or a wearable key without its date, such as sleep.score"),
    window: windowSchema,
    subject: subjectRefSchema
      .optional()
      .describe("subject_ref for a LOINC code; leave out for wearable keys"),
  })
  .strict()
  .describe("A chart of one measure in a window, drawn from audited rows");

export const VIEW_TOOL_DEFINITIONS = [
  {
    name: "show_view",
    description:
      "Show a chart of one measure in the answer. The server reads the rows itself and draws every point; the result says how many readings it drew. A LOINC code needs subject (a synthetic subject_ref); a wearable key reads the user's synced data. Never write data points yourself.",
    input: showViewInput,
  },
] as const;
