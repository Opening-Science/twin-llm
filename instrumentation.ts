/**
 * Next.js calls `register` once per server process before it serves anything.
 * Validating the environment here turns a missing or unsafe setting into a
 * named crash at boot rather than an error on the first request. The edge
 * runtime is skipped: it never reaches the database or the providers.
 */
export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const env = await import("./infrastructure/env");
    env.serverEnv();
  }
};
