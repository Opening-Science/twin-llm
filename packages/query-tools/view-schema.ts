import { z } from "zod";

import { COMPARE_LAYOUTS, MAP_LEVELS } from "@/infrastructure/view-specs";
import { TWIN_FOCUS_IDS } from "@/packages/anatomy/twin-focus";

import { subjectRefSchema, windowSchema } from "./schemas";

/**
 * `show_view`: the model names a measure and a window, the server reads the
 * rows and draws them. `list_views` and `open_view` reopen a view the thread
 * already has instead of drawing it again. All three are in the chat's
 * model-facing list but not in the MCP manifest, since a view only means
 * something inside the app.
 */

export const VIEW_KINDS = [
  "chart.timeseries",
  "chart.compare",
  "biomarker.card",
  "table",
  "twin.body",
  "map.choropleth",
] as const;

export const showViewInput = z
  .object({
    kind: z.enum(VIEW_KINDS),
    measure: z
      .string()
      .min(1)
      .max(128)
      .optional()
      .describe(
        "A LOINC code, or a wearable key without its date, such as sleep.score; not for twin.body",
      ),
    focus: z
      .enum(TWIN_FOCUS_IDS)
      .optional()
      .describe("twin.body only: the organ or body system to show"),
    window: windowSchema
      .optional()
      .describe(
        "Needed for every kind but twin.body; twin.body without it uses each marker's latest reading",
      ),
    subject: subjectRefSchema
      .optional()
      .describe("subject_ref for a LOINC code; leave out for wearable keys"),
    compare_with: windowSchema
      .optional()
      .describe(
        "chart.compare only: the earlier window to set against window, such as the 4 weeks before it",
      ),
    layout: z
      .enum(COMPARE_LAYOUTS)
      .optional()
      .describe(
        "chart.compare only: side-by-side (default) or overlaid by day of window",
      ),
    level: z
      .enum(MAP_LEVELS)
      .optional()
      .describe(
        "map.choropleth only: world (default), region (the places with a value), or country (its states; needs country)",
      ),
    country: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional()
      .describe("map.choropleth with level country: ISO 3166-1 alpha-3, such as NGA"),
  })
  .strict()
  .describe("A view of one measure in a window, drawn from audited rows");

export const listViewsInput = z
  .object({})
  .strict()
  .describe("The charts already shown in this thread");

export const openViewInput = z
  .object({
    id: z.string().min(1).max(256).describe("A view id from list_views"),
  })
  .strict()
  .describe("Show a chart from earlier in this thread again");

export const VIEW_TOOL_DEFINITIONS = [
  {
    name: "show_view",
    description:
      "Show a view of one measure in the answer. chart.timeseries draws every reading in window; chart.compare sets window against compare_with (n and mean of each); biomarker.card shows a LOINC's latest reading against its published range, with its trend; table lists the readings (first 50); twin.body shows the body twin on focus with each mapped organ's range position (subject's labs, or none); without window it uses each marker's latest reading; map.choropleth maps the population estimates this turn already looked up, by country or by a country's states (no measure or window). The server reads the rows itself; the result says how many it read. A LOINC code needs subject (a synthetic subject_ref); a wearable key reads the user's synced data. Never write numbers for a view yourself.",
    input: showViewInput,
  },
  {
    name: "list_views",
    description:
      "List the charts already shown in this thread, newest first: id, title, kind, model and time. Reads no data.",
    input: listViewsInput,
  },
  {
    name: "open_view",
    description:
      "Show a chart from earlier in this thread again by its id from list_views. It is redrawn from the stored view with no new query; use it instead of show_view when the person asks to see a chart again.",
    input: openViewInput,
  },
] as const;
