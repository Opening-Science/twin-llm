import "server-only";

import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { genomeEnv } from "@/infrastructure/env";
import { genomeChatPermit, vcfVariantsChatPermit } from "@/infrastructure/genome-gate";
import { latestGenomeReport } from "@/infrastructure/genome-report-store";
import { genomeVariantReads, hasImportedVcf } from "@/infrastructure/personal-data-store";
import { append } from "@/packages/audit/append";
import { askCarbonX } from "@/packages/carbon-x/client";
import { referenceWindows } from "@/packages/genome-reference";
import type { GenomeVariantsDeps } from "@/packages/query-tools/imported-variants";
import type { SessionScope } from "@/packages/query-tools/scope";

import type { GenomeToolDeps } from "./genome-tools";
import { offerGenomeVariants } from "./genome-variant-offer";

/**
 * The real ports behind the genome tools, or undefined when this turn may not
 * have them. Only the chat route asks. The eval harness never passes genome
 * deps; the training generator (`--genome` only) passes ports that refuse,
 * to read the tool schemas, and never runs a genome tool.
 */
const appendAudit = (input: Parameters<typeof append>[1]) => append(database(), input);

export const genomeToolDepsFor = (scope: SessionScope): GenomeToolDeps | undefined => {
  if (scope.mode !== "personal" || !genomeChatPermit().ok) return undefined;
  const env = genomeEnv();
  return {
    scope,
    loadReport: () => latestGenomeReport(scope.actor),
    assumeBuild: env.assumeBuild,
    windows: (request) => referenceWindows(env.referenceDir, request),
    ask: (messages) =>
      askCarbonX({ baseUrl: env.carbonXUrl, timeoutMs: env.carbonXTimeoutMs }, messages),
    appendAudit,
  };
};

/**
 * The ports behind `genome_variants`, or undefined when this turn may not
 * have it. An imported VCF and a local model are enough (#330): the VCF permit
 * needs personal mode and Ollama on loopback, not `GENOME_SOURCE=ark` or
 * Carbon-X. Without an imported VCF the tool is not offered either (#399);
 * that check counts the person's VCF datasets and opens nothing. The tool asks
 * the same permit again on every call.
 */
export const genomeVariantDepsFor = async (
  scope: SessionScope,
): Promise<GenomeVariantsDeps | undefined> => {
  const user = { lookup: null as Promise<string | null> | null };
  const userId = (): Promise<string | null> => {
    user.lookup ??= findAppUserId(scope.actor);
    return user.lookup;
  };
  const offered = await offerGenomeVariants({
    mode: scope.mode,
    permit: vcfVariantsChatPermit,
    hasImportedVcf: async () => {
      const id = await userId();
      return id !== null && hasImportedVcf(id);
    },
  });
  if (!offered) return undefined;
  return {
    scope,
    permit: vcfVariantsChatPermit,
    ports: { ...genomeVariantReads(userId), appendAudit },
  };
};
