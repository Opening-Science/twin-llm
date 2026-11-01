import type { DataMode, GenomePermitDecision } from "@/infrastructure/data-mode-policy";

/**
 * Is `genome_variants` (#307) offered on this turn (#399)? Only in personal
 * mode, only when the VCF permit holds (#330: a chat model on this machine),
 * and only when the person has imported a VCF. The checks run in that order,
 * so a synthetic or hosted turn never reaches the database. Without a VCF the
 * tool could only refuse, and its definition costs prompt tokens.
 */
export const offerGenomeVariants = async (
  input: Readonly<{
    mode: DataMode;
    permit: () => GenomePermitDecision;
    hasImportedVcf: () => Promise<boolean>;
  }>,
): Promise<boolean> =>
  input.mode === "personal" && input.permit().ok && (await input.hasImportedVcf());
