import type { ToolSet } from "ai";
import { z } from "zod";

import { gbdEstimateRows } from "./gbd-estimate-rows";

/**
 * The population estimates one turn looked up, so `show_view` can map them
 * without the model writing a number. Estimate tools (GBD) are wrapped with
 * `recordEstimates`; every output that parses as estimate rows (a list of
 * rows, as `gbd_population` returns, or a `gbd_estimate` result) is kept, by
 * tool call, in the order the calls finished. One ledger per turn
 * (`createChatTools`), held in memory only.
 */

export const PLACE_LEVELS = ["country", "subnational", "aggregate"] as const;

export type PlaceLevel = (typeof PLACE_LEVELS)[number];

/**
 * One estimate for one place, as an estimate tool returns it. Other fields are
 * ignored. `location_id`, `iso3` (the place's country), `iso3166_2` and
 * `level` come from the GBD location map when the tool knows them.
 */
export const locationEstimateSchema = z.object({
  location: z.string().min(1),
  location_id: z.number().int().optional(),
  iso3: z.string().nullable().optional(),
  iso3166_2: z.string().nullable().optional(),
  level: z.enum(PLACE_LEVELS).optional(),
  value: z.number(),
  lower: z.number().nullable(),
  upper: z.number().nullable(),
  unit: z.string(),
  metric: z.string().optional(),
  measure: z.string().optional(),
  cause: z.string().optional(),
  year: z.string().optional(),
  sex: z.string().optional(),
  age: z.string().optional(),
  source: z.string().optional(),
});

export type LocationEstimate = z.infer<typeof locationEstimateSchema>;

export type RecordedEstimates = Readonly<{
  tool: string;
  callId: string;
  rows: readonly LocationEstimate[];
}>;

export type EstimateLedger = Readonly<{
  record: (tool: string, callId: string, output: unknown) => void;
  recorded: () => readonly RecordedEstimates[];
}>;

const outputRows = z.array(locationEstimateSchema).min(1);

/** A fresh, empty ledger for one turn. */
export const createEstimateLedger = (): EstimateLedger => {
  const entries: RecordedEstimates[] = [];
  return {
    record: (tool, callId, output) => {
      const parsed = outputRows.safeParse(output);
      const rows = parsed.success ? parsed.data : gbdEstimateRows(output);
      if (rows !== null) entries.push({ tool, callId, rows });
    },
    recorded: () => [...entries],
  };
};

const isAsyncIterable = (value: unknown): value is AsyncIterable<unknown> =>
  typeof value === "object" && value !== null && Symbol.asyncIterator in value;

/**
 * The same tools, each noting its output in `ledger` after it ran. The
 * output itself goes on to the model unchanged; a streamed output is not
 * recorded.
 */
export const recordEstimates = <T extends ToolSet>(tools: T, ledger: EstimateLedger): T =>
  Object.fromEntries(
    Object.entries(tools).map(([name, entry]) => {
      const execute = entry.execute;
      if (execute === undefined) return [name, entry];
      return [
        name,
        {
          ...entry,
          execute: async (
            input: Parameters<typeof execute>[0],
            options: Parameters<typeof execute>[1],
          ) => {
            const output: unknown = await execute(input, options);
            if (!isAsyncIterable(output)) ledger.record(name, options.toolCallId, output);
            return output;
          },
        },
      ];
    }),
  ) as T;
