import { postSaveResponse } from "@/features/personal-data/import-routes";

/** Saves a reviewed upload as one dataset (docs/personal-data.md). */
export const maxDuration = 300;

export const POST = (request: Request): Promise<Response> => postSaveResponse(request);
