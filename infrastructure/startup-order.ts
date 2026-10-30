/**
 * The order `instrumentation.ts` runs its startup steps in, kept apart so a
 * test can hold it: the owner-only umask first (#144), so nothing the server
 * writes afterwards is readable by group or others; then the environment;
 * then the storage check, which may create the state folder.
 */
export type StartupSteps = Readonly<{
  restrictUmask: () => void;
  readEnvironment: () => void;
  checkStorage: () => Promise<void>;
}>;

export const runStartup = async (steps: StartupSteps): Promise<void> => {
  steps.restrictUmask();
  steps.readEnvironment();
  await steps.checkStorage();
};
