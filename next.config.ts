import type { NextConfig } from "next";

/**
 * The open-twin provider packages ship TypeScript sources, so Next compiles
 * them along with the app.
 *
 * There is deliberately no analytics proxy route here: when browser analytics
 * are enabled the PostHog client talks to its own host, so requests to it
 * never carry this app's cookies.
 */
const OPEN_TWIN_SOURCE_PACKAGES = [
  "@open-twin/fhir-core",
  "@open-twin/provider-google-health",
  "@open-twin/provider-oura",
  "@open-twin/provider-whoop",
];

const config: NextConfig = {
  transpilePackages: OPEN_TWIN_SOURCE_PACKAGES,
};

export default config;
