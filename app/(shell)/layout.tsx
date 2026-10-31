import { Show, UserButton } from "@clerk/nextjs";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { paletteCommands, skillCommand } from "@/features/commands/registry";
import { threadsForViewer } from "@/features/shell/load-threads";
import { ShellFrame } from "@/features/shell/shell-frame";
import { pinnedFromCookie, SIDEBAR_COOKIE } from "@/features/shell/sidebar-state";
import { ThreadTitleProvider } from "@/features/shell/thread-title";
import { skillsFor } from "@/features/skills/user-skill-store";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import { LockButton } from "@/features/vault/lock-button";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { serverEnv } from "@/infrastructure/env";
import { isClerkEnabled } from "@/infrastructure/public-env";
import { ThreadHistoryProvider as RecentThreads } from "@/infrastructure/thread-history-store";
import { vaultShellState, type VaultShellState } from "@/infrastructure/vault-runtime";

/** Every shell page reads the signed-in person and their threads per request. */
export const dynamic = "force-dynamic";

/** Account menu (when sign-in is on), the lock (personal mode) and the theme switch. */
const NavFooter = ({ vault }: Readonly<{ vault: VaultShellState }>) => (
  <span className="ml-auto inline-flex items-center gap-2">
    {vault.personal ? <LockButton unlocked={vault.unlocked} /> : null}
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
  const vault = await vaultShellState();
  // While personal data is locked (#142) the thread titles are not read at all.
  const threadGroups = vault.unlocked
    ? await threadsForViewer(resolveActorId, findAppUserId)
    : [];
  const actor = await resolveActorId();
  const appUserId = actor === null ? null : await findAppUserId(actor);
  const skills = await skillsFor(appUserId);
  const pinned = pinnedFromCookie((await cookies()).get(SIDEBAR_COOKIE)?.value);
  return (
    <RecentThreads>
      <ThreadTitleProvider>
        <ShellFrame
          threadGroups={threadGroups}
          threadsLocked={!vault.unlocked}
          residency={{ localOnly: LOCAL_ONLY, provider: LLM_PROVIDER }}
          navFooter={<NavFooter vault={vault} />}
          initialPinned={pinned}
          commands={paletteCommands(skills.map(skillCommand))}
        >
          {children}
        </ShellFrame>
      </ThreadTitleProvider>
    </RecentThreads>
  );
}
