import { docsFiles, listDocPages } from "@/features/docs/docs-pages";
import { createSearchHandlers } from "@/features/search/search-handler";
import { indexPending, searchThreads } from "@/features/search/thread-search";
import { indexPorts, threadSearchPorts } from "@/features/search/thread-search-db";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { database } from "@/infrastructure/database";
import { withUnlocked } from "@/infrastructure/vault-runtime";
import { append } from "@/packages/audit/append";

/** Embeds at most this many new prompts or answers per call, within the budget. */
const INDEX_LIMITS = { max: 25, budgetMs: 4000 } as const;

const search = createSearchHandlers({
  resolveActorId,
  findAppUserId,
  searchThreads: (userId, query) => searchThreads(userId, query, threadSearchPorts()),
  indexPending: (userId) => indexPending(userId, indexPorts(), INDEX_LIMITS),
  docs: { listPages: () => listDocPages(docsFiles), readText: docsFiles.readText },
  audit: (event) => append(database(), event),
  logError: console.error,
});

const searchUnlocked = withUnlocked(search.GET);

/** Searching only the docs reads nothing personal, so it works while locked (#142). */
export const GET = (request: Request): Promise<Response> =>
  new URL(request.url).searchParams.get("tab") === "docs"
    ? search.GET(request)
    : searchUnlocked(request);

export const POST = withUnlocked(search.POST);
