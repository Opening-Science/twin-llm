import { APICallError } from "ai";
import { z } from "zod";

// A fixed code allowlist prevents provider-controlled text from reaching the log.
const providerErrorSchema = z.object({
  error: z.object({ code: z.enum(["insufficient_quota"]) }),
});

type PublicProviderFailure = {
  readonly status?: number;
  readonly code: string;
};

const apiCallErrorFrom = (error: unknown): APICallError | null => {
  if (APICallError.isInstance(error)) return error;
  if (error instanceof Error && APICallError.isInstance(error.cause)) {
    return error.cause;
  }
  return null;
};

export const publicProviderFailure = (error: unknown): PublicProviderFailure => {
  const apiError = apiCallErrorFrom(error);
  if (!apiError) return { code: "other" };

  const parsed = providerErrorSchema.safeParse(apiError.data);
  const status = apiError.statusCode;
  return {
    ...(typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
      ? { status }
      : {}),
    code: parsed.success ? parsed.data.error.code : "other",
  };
};
