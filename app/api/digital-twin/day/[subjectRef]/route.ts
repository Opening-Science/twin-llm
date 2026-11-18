import { cohortDeps } from "@/features/digital-twin/biomarkers/cohort-ports";
import { createDayHandler } from "@/features/digital-twin/day/day-handler";

export const GET = createDayHandler(cohortDeps);
