import type { z } from "zod";

import {
  permitGenomeRequest,
  permitProviderForRequest,
  permitVcfVariantsRequest,
} from "@/infrastructure/data-mode-policy";
import { permitSkillRequest } from "@/infrastructure/skill-gate";
import { GENOME_TOOLS } from "@/packages/carbon-x/constants";
import { GENOME_TOOL_DEFINITIONS } from "@/packages/carbon-x/schema";
import { GBD_ESTIMATE_TOOL_DEFINITION } from "@/packages/query-tools/gbd-estimate-schema";
import { GBD_PROFILE_TOOL_DEFINITION } from "@/packages/query-tools/gbd-profile-schema";
import { GENOME_VARIANTS_TOOL_DEFINITION } from "@/packages/query-tools/imported-variants-schema";
import { TOOL_DEFINITIONS } from "@/packages/query-tools/schemas";

import {
  type ScriptedStep,
  type Skill,
  type SkillEvalCase,
  type SkillRefusal,
  type SkillViewKind,
} from "./skill-schema";

/**
 * Runs a skill's eval cases against a scripted model: no network, no real
 * model. Each case scripts what the model tries; the gate here applies the
 * skill's allowlists and the data-mode policy, and the outcome must match the
 * case's `expect` exactly.
 */

export type GateOutcome = Readonly<{
  calls: readonly string[];
  views: readonly SkillViewKind[];
  refusals: readonly SkillRefusal[];
}>;

export type CaseResult = Readonly<{
  skill: string;
  caseId: string;
  passed: boolean;
  actual: GateOutcome;
  expected: GateOutcome;
}>;

const INPUT_SCHEMAS: ReadonlyMap<string, z.ZodType> = new Map<string, z.ZodType>([
  ...TOOL_DEFINITIONS.map((definition) => [definition.name, definition.input] as const),
  ...GENOME_TOOL_DEFINITIONS.map(
    (definition) => [definition.name, definition.input] as const,
  ),
  [GENOME_VARIANTS_TOOL_DEFINITION.name, GENOME_VARIANTS_TOOL_DEFINITION.input],
  [GBD_ESTIMATE_TOOL_DEFINITION.name, GBD_ESTIMATE_TOOL_DEFINITION.input],
  [GBD_PROFILE_TOOL_DEFINITION.name, GBD_PROFILE_TOOL_DEFINITION.input],
]);

/**
 * The genome policy for one call. The eval gate cannot see URLs, so it takes
 * Ollama and Carbon-X as local; the provider, mode and genome source decide.
 * `genome_variants` needs only the VCF permit (#330): mode and provider.
 */
const genomePermitted = (evalCase: SkillEvalCase, tool: string): boolean =>
  tool === GENOME_VARIANTS_TOOL_DEFINITION.name
    ? permitVcfVariantsRequest({
        mode: evalCase.dataMode,
        chatProvider: evalCase.provider,
        chatOnLoopback: true,
      }).ok
    : permitGenomeRequest({
        mode: evalCase.dataMode,
        genomeSource: evalCase.genomeSource,
        chatProvider: evalCase.provider,
        chatOnLoopback: true,
        carbonXOnLoopback: true,
      }).ok;

const requestRefusals = (
  skill: Skill,
  evalCase: SkillEvalCase,
): readonly SkillRefusal[] => {
  const skillPermit = permitSkillRequest(skill, {
    provider: evalCase.provider,
    hasWearableContext: evalCase.wearableContext,
  });
  if (!skillPermit.ok) return [skillPermit.code];
  const permit = permitProviderForRequest({
    mode: evalCase.dataMode,
    provider: evalCase.provider,
    hasWearableNarrative: evalCase.wearableContext,
    exoscalePersonalData: evalCase.exoscalePersonalData,
  });
  return permit.ok ? [] : ["provider-not-permitted-for-data-mode"];
};

type StepOutcome =
  | Readonly<{ kind: "call"; tool: string }>
  | Readonly<{ kind: "view"; view: SkillViewKind }>
  | Readonly<{ kind: "refused"; refusal: SkillRefusal }>;

const isAllowedView = (skill: Skill, view: string): view is SkillViewKind =>
  (skill.views as readonly string[]).includes(view);

const gateStep = (
  skill: Skill,
  evalCase: SkillEvalCase,
  step: ScriptedStep,
): StepOutcome => {
  if ("view" in step) {
    return isAllowedView(skill, step.view)
      ? { kind: "view", view: step.view }
      : { kind: "refused", refusal: "view-not-allowed" };
  }
  if (!skill.tools.includes(step.tool))
    return { kind: "refused", refusal: "tool-not-allowed" };
  if (GENOME_TOOLS.includes(step.tool) && !genomePermitted(evalCase, step.tool)) {
    return { kind: "refused", refusal: "genome-not-permitted" };
  }
  const schema = INPUT_SCHEMAS.get(step.tool);
  if (schema !== undefined && !schema.safeParse(step.input).success) {
    return { kind: "refused", refusal: "invalid-tool-input" };
  }
  return { kind: "call", tool: step.tool };
};

const unique = <T>(items: readonly T[]): readonly T[] => [...new Set(items)];

export const gateCase = (skill: Skill, evalCase: SkillEvalCase): GateOutcome => {
  const refused = requestRefusals(skill, evalCase);
  if (refused.length > 0) return { calls: [], views: [], refusals: refused };
  const steps = evalCase.script.map((step) => gateStep(skill, evalCase, step));
  return {
    calls: steps.flatMap((step) => (step.kind === "call" ? [step.tool] : [])),
    views: steps.flatMap((step) => (step.kind === "view" ? [step.view] : [])),
    refusals: unique(
      steps.flatMap((step) => (step.kind === "refused" ? [step.refusal] : [])),
    ),
  };
};

const sameList = <T>(a: readonly T[], b: readonly T[]): boolean =>
  a.length === b.length && a.every((item, index) => item === b[index]);

const sameSet = <T>(a: readonly T[], b: readonly T[]): boolean =>
  sameList([...a].sort(), [...b].sort());

export const runSkillEvals = (skill: Skill): readonly CaseResult[] =>
  skill.evals.map((evalCase) => {
    const actual = gateCase(skill, evalCase);
    const expected = evalCase.expect;
    return {
      skill: skill.name,
      caseId: evalCase.id,
      passed:
        sameList(actual.calls, expected.calls) &&
        sameList(actual.views, expected.views) &&
        sameSet(actual.refusals, expected.refusals),
      actual,
      expected,
    };
  });
