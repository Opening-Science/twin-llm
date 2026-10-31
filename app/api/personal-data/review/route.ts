import { postReviewResponse } from "@/features/personal-data/import-routes";
import { withUnlocked } from "@/infrastructure/vault-runtime";

/** Parses an upload and answers with what Save would store; stores nothing. */
export const maxDuration = 120;

export const POST = withUnlocked((request: Request): Promise<Response> =>
  postReviewResponse(request),
);
