import "server-only";

import { database } from "@/infrastructure/database";
import { recordDisclosure } from "@/infrastructure/disclosure-ledger-runtime";
import { isLocalOnly, ncbiEnv } from "@/infrastructure/env";
import { append } from "@/packages/audit/append";

import { createTtlCache, type TtlCache } from "./cache";
import {
  CACHE_MAX_ENTRIES,
  CACHE_TTL_MS,
  ENSEMBL_INTERVAL_MS,
  NCBI_INTERVAL_MS,
} from "./constants";
import { createLiveFetch, type LiveFetch } from "./fetch";
import { createSpacing } from "./spacing";
import type { LiveAnswer, LiveToolPorts } from "./tools";

/**
 * The live tools' real ports, made on first use: the server's own fetch, one
 * request queue per service shared by every chat on this server, the answer
 * cache in this server's memory, the disclosure ledger and the audit log.
 */

const clock = {
  now: () => Date.now(),
  sleep: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
};

const shared: { fetch: LiveFetch | null; cache: TtlCache<LiveAnswer> | null } = {
  fetch: null,
  cache: null,
};

const liveFetch = (): LiveFetch => {
  shared.fetch ??= createLiveFetch({
    fetchFn: fetch,
    spacing: {
      pubmed: createSpacing(NCBI_INTERVAL_MS, clock),
      ensembl: createSpacing(ENSEMBL_INTERVAL_MS, clock),
    },
  });
  return shared.fetch;
};

const liveCache = (): TtlCache<LiveAnswer> => {
  shared.cache ??= createTtlCache<LiveAnswer>({
    ttlMs: CACHE_TTL_MS,
    maxEntries: CACHE_MAX_ENTRIES,
    now: clock.now,
  });
  return shared.cache;
};

export const defaultLiveToolPorts = (): LiveToolPorts => ({
  localOnly: isLocalOnly,
  identity: () => ncbiEnv(),
  fetch: (request) => liveFetch()(request),
  recordDisclosure,
  append,
  database,
  cache: liveCache(),
});
