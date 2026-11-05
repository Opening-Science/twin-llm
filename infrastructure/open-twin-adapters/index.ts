/**
 * The one entry point to the Oura, WHOOP and Google Health host adapters.
 * Code outside this folder imports `@/infrastructure/open-twin-adapters` and
 * never a file in it (eslint `twin-llm/wearable-entry`), so replacing the
 * adapters (open-twin reader-core) touches this folder only. Re-exports
 * only; behaviour lives in the sibling files.
 */
export { aggregateWearableBundles } from "./aggregate";
export { getGoogleHealthCredentials, setGoogleHealthCredentials } from "./google-health";
export { getAuthorizationUrl, HostOuraTokenHandler } from "./oura";
export { buildOuraFhirBundle } from "./oura-bundle";
export {
  buildWhoopFhirBundle,
  fetchWhoopWindow,
  type WhoopHostPayload,
  type WhoopWorkout,
} from "./whoop";
export { fetchWhoopWorkouts, WHOOP_HR_ZONES, whoopSportName } from "./whoop-workout";
