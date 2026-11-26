import "server-only";

import {
  type MeasureRequest,
  type MeasureResolution,
  needsReadings,
  type ResolvedMeasure,
  resolveMeasures,
} from "./measure-names";
import { type MeasureRefusal, unknownMeasure } from "./measure-refusals";
import {
  defaultQueryToolPorts,
  findSubjectCodesInDatabase,
  type QueryToolPorts,
} from "./ports";
import {
  SUBJECT_SCOPE_VIOLATION,
  type SessionScope,
  type SubjectScopeViolation,
} from "./scope";
import { audited, subjectInScope } from "./tool-core";

/**
 * The warehouse tools' side of #900: a call names its measure by `loinc`, by
 * `measure` (a name) or, for the list tools, both. The code is settled here,
 * before the tool reads anything; the tool then runs with `loinc` filled in,
 * so its audit entry records the name and the code it was read as. A refusal
 * here is audited under the tool's name with 0 rows.
 */

type OneMeasure = Readonly<{ subject_ref: string; loinc?: string; measure?: string }>;

type ManyMeasures = Readonly<{
  subject_ref: string;
  loinc?: readonly string[];
  measure?: readonly string[];
}>;

/** A tool's input once its measure is a code. */
export type WithCode<I> = Omit<I, "loinc"> & Readonly<{ loinc: string }>;
export type WithCodes<I> = Omit<I, "loinc"> & Readonly<{ loinc: string[] }>;

/** What the answer may say it read: each name with the code it was read as. */
export type MeasuresResolved = Readonly<{
  resolved_measures: readonly ResolvedMeasure[];
}>;

const settle = async (
  scope: SessionScope,
  subjectRef: string,
  request: MeasureRequest,
  ports: QueryToolPorts,
): Promise<MeasureResolution | MeasureRefusal | SubjectScopeViolation> => {
  // Which codes a subject has is data: never asked outside the scope.
  if (
    needsReadings(request.measure) &&
    !(await subjectInScope(scope, subjectRef, ports))
  ) {
    return SUBJECT_SCOPE_VIOLATION;
  }
  const find = ports.findSubjectCodes ?? findSubjectCodesInDatabase;
  return resolveMeasures(
    request,
    async (codes) => new Set(await find(subjectRef, codes)),
  );
};

const withResolved = <R>(result: R, resolved: readonly ResolvedMeasure[]): R =>
  resolved.length === 0 || typeof result !== "object" || result === null
    ? result
    : { ...result, resolved_measures: resolved };

const refuse = <R>(
  scope: SessionScope,
  tool: string,
  input: Readonly<{ subject_ref: string }>,
  refusal: MeasureRefusal | SubjectScopeViolation,
  ports: QueryToolPorts,
): Promise<R | MeasureRefusal | SubjectScopeViolation> =>
  audited<R | MeasureRefusal | SubjectScopeViolation>(
    scope,
    tool,
    input,
    input.subject_ref,
    async () => refusal,
    () => 0,
    ports,
  );

/** Runs a one-measure tool with its code settled; a result also names what a name was read as. */
export const withMeasure = async <I extends OneMeasure, R>(
  scope: SessionScope,
  tool: string,
  input: I,
  run: (input: WithCode<I>) => Promise<R>,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<R | MeasureRefusal | SubjectScopeViolation> => {
  const outcome = await settle(
    scope,
    input.subject_ref,
    {
      loinc: input.loinc === undefined ? [] : [input.loinc],
      measure: input.measure === undefined ? [] : [input.measure],
    },
    ports,
  );
  if (!("codes" in outcome)) return refuse<R>(scope, tool, input, outcome, ports);
  const [code] = outcome.codes;
  // Only a caller that skipped the schema can name no measure at all.
  if (code === undefined) {
    return refuse<R>(scope, tool, input, unknownMeasure("", []), ports);
  }
  return withResolved(await run({ ...input, loinc: code }), outcome.resolved);
};

/** The same for the tools that read up to 20 measures at once. */
export const withMeasures = async <I extends ManyMeasures, R>(
  scope: SessionScope,
  tool: string,
  input: I,
  run: (input: WithCodes<I>) => Promise<R>,
  ports: QueryToolPorts = defaultQueryToolPorts(),
): Promise<R | MeasureRefusal | SubjectScopeViolation> => {
  const outcome = await settle(
    scope,
    input.subject_ref,
    { loinc: input.loinc ?? [], measure: input.measure ?? [] },
    ports,
  );
  if (!("codes" in outcome)) return refuse<R>(scope, tool, input, outcome, ports);
  return withResolved(
    await run({ ...input, loinc: [...outcome.codes] }),
    outcome.resolved,
  );
};
