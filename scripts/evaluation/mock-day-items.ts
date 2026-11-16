/**
 * The mock-day item set (`evaluation/mock-day.items.v1.json`): questions about
 * the illustrative mock day (`packages/query-tools/fixtures/mock-day.json`)
 * that an answer from `show_my_day` must get right. Each expected value names
 * a dotted path into the day as `show_my_day` lays it out (`beats`,
 * `red_windows`) and the value written there; the item test recomputes every
 * one from the fixture, so the set cannot drift from the code. Pure, no I/O.
 *
 * The C3 harness reads the warehouse, and the mock day is not in it, so these
 * items are scored once a run can load the mock day.
 */
import { z } from "zod";

import { CRITERIA } from "./question-set";

export const MOCK_DAY_ITEMS_VERSION = "twin-llm.eval.mock-day.v1";

const expectedValue = z
  .object({
    name: z.string().regex(/^[a-z0-9_]+$/),
    /** Dotted path into `{ beats, red_windows }`, as `readPath` reads it. */
    path: z.string().min(1),
    value: z.union([z.number(), z.string(), z.null()]),
  })
  .strict();

export const mockDayItemSchema = z
  .object({
    id: z.string().regex(/^D-\d{2}$/),
    criteria: z.array(z.enum(CRITERIA)).min(1),
    question: z.string().min(10),
    profile: z.enum(["without_diabetes", "with_diabetes"]),
    expect: z
      .object({
        must_call: z.array(z.literal("show_my_day")).length(1),
        values: z.array(expectedValue),
        /** Phrases or behaviours that fail the item when present. */
        must_not: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    /** Notes for the human sheet. */
    human: z.string().min(1),
  })
  .strict();

export type MockDayItem = z.infer<typeof mockDayItemSchema>;

export const mockDayItemSetSchema = z
  .object({
    schema_version: z.literal(MOCK_DAY_ITEMS_VERSION),
    fixture: z.literal("packages/query-tools/fixtures/mock-day.json"),
    items: z.array(mockDayItemSchema).min(1),
  })
  .strict()
  .superRefine((set, ctx) => {
    const ids = set.items.map((item) => item.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", message: "item ids repeat" });
    }
  });

export type MockDayItemSet = z.infer<typeof mockDayItemSetSchema>;
