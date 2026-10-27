/**
 * Families about units: MIXED_UNITS refusals from the analytics tools, and
 * a latest value asked for in another unit. The answer never converts by
 * itself: a pair `convert_unit`'s table holds is converted by that tool (only
 * from the stored unit it was written for) and the reply gives the tool's
 * value, formula and rounding; any other pair is reported in the stored unit.
 */
import { pick } from "../synthetic-wearables/random";

import { baselineDeviation, compareWindows, trend } from "./data-families";
import {
  asked,
  describe,
  type Draft,
  type FamilyContext,
  field,
  fullRecord,
  num,
  refusalReply,
  sections,
  str,
  SYNTHETIC_NOTE,
  type ToolCall,
  yearsBefore,
} from "./family-kit";
import { formatDay, formatValue, unitText } from "./format";
import { formatNumber } from "../../infrastructure/format-measure";
import { type Conversion, CONVERSIONS, MIXED_UNIT_MEASURES } from "./measures";
import { ask } from "./questions";
import { isToolRefusal } from "../../packages/query-tools/refusals";
import {
  findConversion,
  isConversionUnit,
} from "../../packages/query-tools/unit-conversions";

/**
 * A mixed-unit question, only for a subject whose records really hold one of
 * the mixed-unit codes in two units. A planning read (`subject_window`, then
 * one `coverage` over the mixed-unit codes for the last six years; not part of
 * the conversation) finds the code. The conversation then asks for a trend,
 * baseline or comparison and reports what the tool returned, usually
 * MIXED_UNITS.
 */
export const unitMismatch = async (context: FamilyContext): Promise<Draft | null> => {
  const planning: ToolCall[] = [];
  const record = await fullRecord(context, planning);
  if (record === null) return null;
  const probe = await context.run("coverage", {
    subject_ref: context.subjectRef,
    loinc: MIXED_UNIT_MEASURES.map((measure) => measure.loinc),
    start: yearsBefore(record.end, 6),
    end: record.end,
  });
  if (!isToolRefusal(probe) || probe.code !== "MIXED_UNITS" || !("loinc" in probe)) {
    return null;
  }
  const measure = MIXED_UNIT_MEASURES.find((item) => item.loinc === probe.loinc);
  if (measure === undefined) return null;
  const build = pick(context.random, [trend, baselineDeviation, compareWindows] as const);
  return build(context, measure, "unit_mismatch");
};

/** The latest value in the unit the question names, converted by `convert_unit` when its table holds the pair. */
export const unitConversion = async (
  context: FamilyContext,
  pool: readonly [Conversion, ...Conversion[]],
): Promise<Draft> => {
  const conversion = pick(context.random, pool);
  const { measure } = conversion;
  const question = ask(context.random, "unitConversion", {
    label: pick(context.random, [measure.label, ...(measure.aliases ?? [])]),
    ref: context.subjectRef,
    unit: conversion.to,
  });
  const args = { subject_ref: context.subjectRef, loinc: [measure.loinc] };
  const result = await context.run("latest_by_loinc", args);
  const base = {
    family: "unit_conversion",
    ...asked(question),
    measureLoinc: measure.loinc,
    subjectRef: context.subjectRef,
    calls: [{ name: "latest_by_loinc", args, result }],
  } as const;
  const refused = refusalReply(result, "latest_by_loinc", measure, context.subjectRef);
  if (refused) return { ...base, ...refused };
  const rows = field(result, "rows");
  const row = Array.isArray(rows) ? (rows[0] as unknown) : undefined;
  const value = num(row, "value");
  if (row === undefined || value === null) {
    return {
      ...base,
      outcome: "no_rows",
      reply: sections(
        `I called \`latest_by_loinc\` for subject ${context.subjectRef}, ${describe(measure)}. It returned no rows.`,
        `There is no ${measure.label} reading for subject ${context.subjectRef}, so there is nothing to give in ${conversion.to}.`,
        `No rows is not the same as a value of zero. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  const unit = str(row, "unit_ucum");
  const at = formatDay(str(row, "effective_at"));
  const shown = formatValue(value, unit, measure.decimals);
  const read = `I called \`latest_by_loinc\` for subject ${context.subjectRef}, ${describe(measure)}. It returned one row: ${shown} on ${at}.`;
  if (unit !== conversion.from) {
    return {
      ...base,
      outcome: "answered",
      reply: sections(
        `${read} The reading is stored in ${unitText(unit) || "no unit"}, not ${unitText(conversion.from)}, so the fixed conversion to ${conversion.to} does not apply.`,
        `The latest ${measure.label} for subject ${context.subjectRef} is ${shown}, recorded on ${at}. I report it in the unit it was stored in rather than guess a conversion to ${conversion.to}.`,
        `Converting from an unexpected unit could give a wrong number. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  const tool = conversion.tool;
  const rule =
    tool === null || !isConversionUnit(unit)
      ? null
      : findConversion(tool.analyte, unit, tool.to);
  if (tool === null || rule === null) {
    return {
      ...base,
      outcome: "not_converted",
      reply: sections(
        `${read} \`convert_unit\` has no conversion for ${measure.label} to ${conversion.to}, and I do not convert numbers by hand.`,
        `The latest ${measure.label} for subject ${context.subjectRef} is ${shown}, recorded on ${at}. I give it in the unit it was stored in, ${unitText(unit)}, because no tool here converts it to ${conversion.to}.`,
        `A conversion done in the text could not be checked against a tool result. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  const convertArgs = { value, from: unit, to: tool.to, analyte: tool.analyte };
  const converted = await context.run("convert_unit", convertArgs);
  const calls: readonly ToolCall[] = [
    ...base.calls,
    { name: "convert_unit", args: convertArgs, result: converted },
  ];
  const convertedValue = num(converted, "value");
  if (isToolRefusal(converted) || convertedValue === null) {
    return {
      ...base,
      calls,
      outcome: "not_converted",
      reply: sections(
        `${read} I called \`convert_unit\` to convert it to ${conversion.to}; it refused, so there is no converted value.`,
        `The latest ${measure.label} for subject ${context.subjectRef} is ${shown}, recorded on ${at}, in the unit it was stored in.`,
        `I do not convert numbers by hand. ${SYNTHETIC_NOTE}`,
      ),
    };
  }
  const shownConverted = `${formatNumber(convertedValue, rule.decimals)} ${conversion.to}`;
  return {
    ...base,
    calls,
    outcome: "converted",
    reply: sections(
      `${read} I called \`convert_unit\` for ${measure.label} from ${unitText(unit)} to ${conversion.to}. It used ${str(converted, "formula") ?? rule.formula} and returned ${shownConverted}, rounded ${str(converted, "rounding") ?? ""}.`,
      `The latest ${measure.label} for subject ${context.subjectRef} is ${shownConverted} (${shown} as stored), recorded on ${at}.`,
      `The record stores ${measure.label} in ${unitText(unit)}; the value in ${conversion.to} is the tool's arithmetic on that reading and is rounded. One reading says nothing about a pattern. ${SYNTHETIC_NOTE}`,
    ),
  };
};

/** Conversions a subject can be asked about: wearable ones only with a series. */
export const conversionsFor = (
  hasWearables: boolean,
): readonly [Conversion, ...Conversion[]] => {
  const kept = CONVERSIONS.filter(
    (conversion) => hasWearables || conversion.measure.source === "clinical",
  );
  const [first, ...rest] = kept;
  return first === undefined ? CONVERSIONS : [first, ...rest];
};
