import { createCohortListHandler } from "@/features/digital-twin/biomarkers/cohort-handler";
import { cohortDeps } from "@/features/digital-twin/biomarkers/cohort-ports";

export const GET = createCohortListHandler(cohortDeps);
