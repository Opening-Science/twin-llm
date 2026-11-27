import { cohortDeps } from "@/features/digital-twin/biomarkers/cohort-ports";
import { createDayHandler } from "@/features/digital-twin/day/kiosk/day-handler";

export const GET = createDayHandler(cohortDeps);
