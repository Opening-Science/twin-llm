import { defineConfig } from "vitest/config";

/**
 * One config for the tests copied with the open-twin packages, run from each
 * package's folder by scripts/open-twin/test.ts. Upstream's own configs, less
 * the SWC decorator plugin and reflect-metadata (no source uses decorators)
 * and jest-extended (no test uses its matchers).
 */
export default defineConfig({
  test: {
    watch: false,
    environment: "node",
    restoreMocks: true,
    mockReset: true,
    typecheck: { enabled: false },
    hookTimeout: 20_000,
    testTimeout: 20_000,
    // Upstream's testSetup.ts set this; nothing in the sources reads it.
    env: { NODE_ENV: "development" },
  },
});
