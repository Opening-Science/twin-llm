import { getArkAuditResponse } from "@/features/digital-twin/ark-audit";

export const GET = (): Promise<Response> => getArkAuditResponse();
