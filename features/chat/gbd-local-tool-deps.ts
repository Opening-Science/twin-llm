import "server-only";

import { database } from "@/infrastructure/database";
import { gbdEstimatePorts, hasGbdEstimates } from "@/packages/gbd-local/store";
import type { GbdEstimatePorts } from "@/packages/query-tools/gbd-estimate";

/**
 * The local GBD store's ports when it holds estimates (#387), else
 * undefined, so a turn is offered `gbd_estimate` only once something is
 * imported. A failed check (the migration not applied yet) offers nothing.
 */
export const gbdLocalPortsIfImported = async (): Promise<
  GbdEstimatePorts | undefined
> => {
  const imported = await hasGbdEstimates(database()).catch((error: unknown) => {
    console.error(
      "[gbd] local store check failed",
      error instanceof Error ? error.name : "",
    );
    return false;
  });
  return imported ? gbdEstimatePorts(database) : undefined;
};
