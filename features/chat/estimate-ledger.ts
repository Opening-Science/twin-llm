import type { ToolSet } from "ai";
import { z } from "zod";

/**
 * The population estimates one turn looked up, so `show_view` can map them
 * without the model writing a number. Estimate tools (GBD) are wrapped with
 * `recordEstimates`; every output that parses as estimate rows is kept, by
 * tool call, in the order the calls finished. One ledger per turn
 * (`createChatTools`), held in memory only.
 */

/** One estimate for one place, as an estimate tool returns it. Other fields are ignored. */
export const locationEstimateSchema = z.object({
  location: z.string().min(1),
  value: z.number(),
  lower: z.number().nullable(),
  upper: z.number().nullable(),
  unit: z.string(),
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
      if (parsed.success) entries.push({ tool, callId, rows: parsed.data });
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
