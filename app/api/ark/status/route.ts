import { getArkStatusResponse } from "@/features/connectors/ark-status";

export const GET = (): Promise<Response> => getArkStatusResponse();
