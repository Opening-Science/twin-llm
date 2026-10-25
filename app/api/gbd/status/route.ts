import { getGbdStatusResponse } from "@/features/gbd/gbd-status";

export const GET = (): Promise<Response> => getGbdStatusResponse();
