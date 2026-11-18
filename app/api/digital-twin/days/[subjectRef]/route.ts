import { cohortDeps } from "@/features/digital-twin/biomarkers/cohort-ports";
import { createDayListHandler } from "@/features/digital-twin/day/day-handler";

export const GET = createDayListHandler(cohortDeps);
