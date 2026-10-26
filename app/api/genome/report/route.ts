import { getGenomeReportResponse } from "@/features/digital-twin/genome-run";

export const GET = (): Promise<Response> => getGenomeReportResponse();
