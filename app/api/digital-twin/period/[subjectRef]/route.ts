import { cohortDeps } from "@/features/digital-twin/biomarkers/cohort-ports";
import { createPeriodHandler } from "@/features/digital-twin/day/kiosk/day-handler";

export const GET = createPeriodHandler(cohortDeps);
