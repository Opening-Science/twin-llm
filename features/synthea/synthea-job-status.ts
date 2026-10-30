import type { LatticeState } from "@/infrastructure/ui-kit/status-lattice-model";

import type { JobState } from "./synthea-queue";

/**
 * A run's state for the status lattice. Waiting in line counts as working,
 * since the person is waiting either way. An expired or downloaded run did
 * finish, so it keeps its tick; the sentence under it says the files are gone.
 */
export const latticeStateOf = (state: JobState): LatticeState => {
  switch (state) {
    case "queued":
    case "running":
      return "working";
    case "done":
    case "expired":
    case "downloaded":
      return "done";
    case "failed":
    case "timed-out":
      return "error";
  }
};
