import { Show, UserButton } from "@clerk/nextjs";
import type { ReactNode } from "react";

import { threadsForViewer } from "@/features/shell/load-threads";
import { ShellFrame } from "@/features/shell/shell-frame";
import { ThreadTitleProvider } from "@/features/shell/thread-title";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { serverEnv } from "@/infrastructure/env";
import { isClerkEnabled } from "@/infrastructure/public-env";
import { ThreadHistoryProvider as RecentThreads } from "@/infrastructure/thread-history-store";

/** Every shell page reads the signed-in person and their threads per request. */
export const dynamic = "force-dynamic";

/** Account menu (when sign-in is on) and the theme switch, bottom of the sidebar. */
const NavFooter = () => (
  <span className="ml-auto inline-flex items-center gap-2">
    {isClerkEnabled() ? (
      <Show when="signed-in">
        <UserButton />
      </Show>
    ) : null}
    <ThemeToggle />
  </span>
);

export default async function ShellPagesLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const { LOCAL_ONLY, LLM_PROVIDER } = serverEnv();
  const threadGroups = await threadsForViewer(resolveActorId, findAppUserId);
  return (
    <RecentThreads>
      <ThreadTitleProvider>
        <ShellFrame
          threadGroups={threadGroups}
          residency={{ localOnly: LOCAL_ONLY, provider: LLM_PROVIDER }}
          navFooter={<NavFooter />}
        >
          {children}
        </ShellFrame>
      </ThreadTitleProvider>
    </RecentThreads>
  );
}
