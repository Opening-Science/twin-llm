import { postReviewResponse } from "@/features/personal-data/import-routes";

/** Parses an upload and answers with what Save would store; stores nothing. */
export const maxDuration = 120;

export const POST = (request: Request): Promise<Response> => postReviewResponse(request);
