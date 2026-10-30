/** Small hand-made people for the analysis tests. */
import { type Topic } from "./codes";
import { dayNumber, type Person } from "./cohort";

export const day = dayNumber;

export const person = (
  id: string,
  options: Partial<{
    sex: "F" | "M";
    birth: string;
    end: string;
    died: boolean;
    onset: Partial<Record<Topic, string>>;
    anticoagulant: string;
    observedFrom: string;
  }> = {},
): Person => ({
  id,
  batch: "001",
  sex: options.sex ?? "M",
  birth: day(options.birth ?? "1940-01-01"),
  end: day(options.end ?? "2026-01-01"),
  observedFrom:
    options.observedFrom === undefined
      ? Number.NEGATIVE_INFINITY
      : day(options.observedFrom),
  died: options.died ?? false,
  onset: Object.fromEntries(
    Object.entries(options.onset ?? {}).map(([topic, at]) => [topic, day(at as string)]),
  ),
  anticoagulant: options.anticoagulant === undefined ? null : day(options.anticoagulant),
});
