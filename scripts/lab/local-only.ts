import { localOnlyCheck, localOnlyReport } from "../../features/lab/local-only-check";
import { serverEnv } from "../../infrastructure/env";

/**
 * `bun run lab:local-only`: the Local only card from the Lab page, as text.
 * Reads the same settings the app does (Bun loads .env and .env.local) and
 * prints the switches and service names, never a key or URL.
 */

try {
  console.log(localOnlyReport(localOnlyCheck(serverEnv())));
} catch (error) {
  console.error(
    error instanceof Error ? error.message : "The settings could not be read.",
  );
  process.exit(1);
}
