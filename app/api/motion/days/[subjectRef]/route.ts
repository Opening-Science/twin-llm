import { cohortDeps } from "@/features/digital-twin/biomarkers/cohort-ports";
import { createMotionDaysHandler } from "@/features/digital-twin/motion/days-handler";

export const GET = createMotionDaysHandler(cohortDeps);
