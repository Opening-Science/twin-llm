/**
 * Next.js calls `register` once per server process before it serves anything.
 * Validating the environment here turns a missing or unsafe setting into a
 * named crash at boot rather than an error on the first request. The edge
 * runtime is skipped: it never reaches the database or the providers.
 *
 * The umask comes first, so every file the server writes afterwards is
 * owner-only. Then the storage check (#144): personal mode does not start
 * unless the state folder, env files, mesh files and the database connection
 * are open to the owner's OS user only (`infrastructure/startup-order.ts`).
 */
export const register = async (): Promise<void> => {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { runStartup } = await import("./infrastructure/startup-order");
    const storage = await import("./infrastructure/storage-runtime");
    const env = await import("./infrastructure/env");
    await runStartup({
      restrictUmask: storage.restrictUmask,
      readEnvironment: () => {
        env.serverEnv();
      },
      checkStorage: storage.checkStorageAtStartup,
    });
  }
};
