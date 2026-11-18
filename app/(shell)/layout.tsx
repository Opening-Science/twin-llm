import { SignInButton, UserButton } from "@clerk/nextjs";
import { cookies } from "next/headers";
import type { ReactNode } from "react";

import { AppFrame } from "@/features/app-shell/app-frame";
import { BrandLine } from "@/features/app-shell/brand-line";
import { threadsForViewer } from "@/features/app-shell/load-threads";
import { OpenThreadProvider } from "@/features/app-shell/open-thread";
import { ResearchFooter } from "@/features/app-shell/research-footer";
import { pinnedFromCookie, SIDEBAR_COOKIE } from "@/features/app-shell/sidebar-state";
import { paletteCommands, skillCommand } from "@/features/commands/registry";
import { LAB_LINE, LAB_PARTS, LAB_PATH, LAB_TITLE } from "@/features/lab/lab-hub";
import { SearchBox, SearchRow } from "@/features/search/search-box";
import { staticSearchItems } from "@/features/search/search-items";
import { skillsFor } from "@/features/skills/user-skill-store";
import { TaskNoticeBadge, TaskNotices } from "@/features/tasks/task-notices";
import { ThemeToggle } from "@/features/theme/theme-toggle";
import { LockButton } from "@/features/vault/lock-button";
import { resolveActorId } from "@/infrastructure/auth-actor";
import { findAppUserId } from "@/infrastructure/current-user";
import { serverEnv } from "@/infrastructure/env";
import { isClerkEnabled } from "@/infrastructure/public-env";
import { ThreadHistoryProvider } from "@/infrastructure/thread-history-store";
import { Button } from "@/infrastructure/ui-kit/button";
import { vaultShellState } from "@/infrastructure/vault-runtime";

import { markTasksSeenAction } from "./customize/tasks/actions";

/** Who is asking decides what the sidebar lists, so the shell renders per request. */
export const dynamic = "force-dynamic";

/**
 * The frame of every shell page: the sidebar with the viewer's threads, the
 * search box, the thread bar, the research footer and the scheduled-run
 * notices. This layout reads what the frame needs and hands the pieces
 * other features own (task badge, lock, theme, account, sign-in) to it as
 * slots, so `features/app-shell` stays inside its own folder.
 */
export default async function ShellLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  const env = serverEnv();
  const signInConfigured = isClerkEnabled();
  const [vault, actor, cookieJar] = await Promise.all([
    vaultShellState(),
    resolveActorId(),
    cookies(),
  ]);
  const appUserId = actor === null ? null : await findAppUserId(actor);
  // Thread titles are not read at all while the vault is locked (#142).
  const threads = vault.unlocked ? await threadsForViewer(appUserId) : [];
  const skills = await skillsFor(appUserId);

  const statics = staticSearchItems({
    lab: LAB_PARTS.map((part) => ({
      title: LAB_TITLE[part],
      line: LAB_LINE[part],
      path: LAB_PATH[part],
    })),
    commands: paletteCommands(skills.map(skillCommand)).map(({ name, description }) => ({
      name,
      description,
    })),
  });

  const signedIn = actor !== null;

  return (
    <ThreadHistoryProvider>
      <OpenThreadProvider>
        <SearchBox threads={threads} statics={statics}>
          <AppFrame
            initialPinned={pinnedFromCookie(cookieJar.get(SIDEBAR_COOKIE)?.value)}
            sidebar={{
              threads,
              renderedAt: new Date().toISOString(),
              signedIn,
              vaultLocked: !vault.unlocked,
              slots: {
                searchRow: <SearchRow />,
                customizeBadge: <TaskNoticeBadge />,
                brand: <BrandLine />,
                controls: (
                  <>
                    {vault.personal && <LockButton unlocked={vault.unlocked} />}
                    {signInConfigured && signedIn && <UserButton />}
                    <ThemeToggle />
                  </>
                ),
                signIn: signInConfigured ? (
                  <SignInButton mode="modal">
                    <Button variant="secondary" size="sm">
                      Sign in
                    </Button>
                  </SignInButton>
                ) : null,
              },
            }}
            footer={
              <ResearchFooter
                residency={{ localOnly: env.LOCAL_ONLY, provider: env.LLM_PROVIDER }}
              />
            }
          >
            {children}
          </AppFrame>
          {signedIn && <TaskNotices markSeen={markTasksSeenAction} />}
        </SearchBox>
      </OpenThreadProvider>
    </ThreadHistoryProvider>
  );
}
