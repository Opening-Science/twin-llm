import Link from "next/link";

import type { ShellThread } from "@/infrastructure/recent-threads";

import { RECENT_CHATS, recentChatMeta } from "./dashboard-sections";

/**
 * The Chat section's list: the viewer's newest threads as the sidebar lists
 * them (titles already opened and made readable on the server), each one a
 * link to its thread. Nothing of an answer is shown.
 */
export const RecentChats = ({
  threads,
}: Readonly<{ threads: readonly ShellThread[] }>) => {
  const shown = threads.slice(0, RECENT_CHATS.shown);
  if (shown.length === 0) {
    return <p className="text-muted-foreground text-sm">{RECENT_CHATS.empty}</p>;
  }
  return (
    <ul aria-label={RECENT_CHATS.label} className="surface divide-border divide-y">
      {shown.map((thread) => (
        <li key={thread.id}>
          <Link
            href={`/t/${thread.id}`}
            className="hover:bg-muted flex flex-col gap-0.5 px-4 py-3 sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
          >
            <span className="min-w-0 truncate text-sm font-medium">{thread.title}</span>
            <span className="text-muted-foreground shrink-0 text-xs">
              {recentChatMeta(thread.updatedAt, thread.modelCount)}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
};
