import { getGenomeReportResponse } from "@/features/digital-twin/genome-run";
import { withUnlocked } from "@/infrastructure/vault-runtime";

export const GET = withUnlocked((): Promise<Response> => getGenomeReportResponse());
