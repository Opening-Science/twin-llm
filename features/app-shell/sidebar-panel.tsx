"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  type MouseEvent,
  type ReactNode,
  useId,
  useMemo,
  useSyncExternalStore,
} from "react";

import { formatNumber } from "@/infrastructure/format-measure";
import { mergeRecentThreads, type ShellThread } from "@/infrastructure/recent-threads";
import { useThreadHistory } from "@/infrastructure/thread-history-store";
import {
  BodyIcon,
  BookIcon,
  ChatIcon,
  FlagIcon,
  FlaskIcon,
  PlusIcon,
  SlidersIcon,
  StackIcon,
} from "@/infrastructure/ui-kit/nav-icons";

import { dayKey, groupByDay, type ViewerDay } from "./day-groups";
import { isCurrentSection, modelCountText, SECTIONS, type SectionKey } from "./sections";
import { threadIdOfPath } from "./thread-crumb";

/**
 * What the sidebar holds, the same in all three of its presentations (the
 * pinned column, the peeking panel and the phone menu): the wordmark, the
 * sections, the viewer's threads and a footer. Pieces owned by other parts
 * of the app (the Search row, the task badge, the lock, account and theme
 * controls, the sign-in button) come in as slots from the shell layout.
 */

export type SidebarSlots = Readonly<{
  searchRow: ReactNode;
  customizeBadge: ReactNode;
  brand: ReactNode;
  controls: ReactNode;
  /** Shown to a signed-out viewer when sign-in is configured; null otherwise. */
  signIn: ReactNode;
}>;

export type SidebarData = Readonly<{
  threads: readonly ShellThread[];
  /** When the server drew the page, ISO 8601: the day used until the browser's is known. */
  renderedAt: string;
  signedIn: boolean;
  vaultLocked: boolean;
  slots: SidebarSlots;
}>;

export const SIDEBAR_COPY = {
  locked: "Locked. Unlock to see your threads.",
  empty: "No threads yet. Your first prompt starts one.",
  signIn: "Sign in to keep your threads and come back to them.",
} as const;

const SECTION_ICON: Readonly<
  Record<SectionKey, (props: { className?: string }) => ReactNode>
> = {
  home: ChatIcon,
  twin: BodyIcon,
  customize: SlidersIcon,
  models: StackIcon,
  lab: FlaskIcon,
  docs: BookIcon,
  start: FlagIcon,
};

const MINUTE_MS = 60_000;
const everyMinute = (onChange: () => void) => {
  const timer = setInterval(onChange, MINUTE_MS);
  return () => clearInterval(timer);
};

const viewerZone = (): string => Intl.DateTimeFormat().resolvedOptions().timeZone;

/**
 * The viewer's own calendar day and time zone. The server and the first
 * browser render use UTC and the server's clock, so hydration matches; the
 * browser then regroups in its own zone and checks for a new day each minute.
 */
const useViewerDay = (renderedAt: string): ViewerDay => {
  const serverDay = `UTC|${dayKey(new Date(renderedAt), "UTC")}`;
  const snapshot = useSyncExternalStore(
    everyMinute,
    () => {
      const timeZone = viewerZone();
      return `${timeZone}|${dayKey(new Date(), timeZone)}`;
    },
    () => serverDay,
  );
  const [timeZone = "UTC", today = ""] = snapshot.split("|");
  return { timeZone, today };
};

export const SidebarPanel = ({
  data,
  headerControl,
  onFollow,
}: Readonly<{
  data: SidebarData;
  /** The pin button or the phone menu's close button. */
  headerControl?: ReactNode;
  /** Called when a link or the Search row inside is used. */
  onFollow?: () => void;
}>) => {
  const path = usePathname();

  // Following a link (or the Search row) closes a peeking panel or the phone
  // menu first. Capture, so the menu is gone before search opens its own box.
  const follow = (event: MouseEvent<HTMLDivElement>) => {
    if (onFollow === undefined || !(event.target instanceof Element)) return;
    if (event.target.closest("a[href], [data-closes-panel]") !== null) onFollow();
  };

  return (
    <div className="flex h-full min-h-0 w-full flex-col" onClickCapture={follow}>
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 pr-3 pl-5">
        <Link href="/" className="font-display rounded-sm text-xl tracking-tight">
          TwinLLM
        </Link>
        {headerControl}
      </div>

      <nav aria-label="Sections" className="flex shrink-0 flex-col px-3 pb-4">
        {data.slots.searchRow}
        {SECTIONS.map((section) => {
          const Icon = SECTION_ICON[section.key];
          return (
            <Link
              key={section.key}
              href={section.href}
              className="nav-link"
              aria-current={isCurrentSection(section.href, path) ? "page" : undefined}
            >
              <Icon />
              {section.label}
              {section.key === "customize" && data.slots.customizeBadge}
            </Link>
          );
        })}
      </nav>

      <YourThreads data={data} path={path} />

      <div className="border-border flex shrink-0 items-center gap-2 border-t px-4 py-3">
        {data.slots.brand}
        <div className="ml-auto flex items-center gap-1">{data.slots.controls}</div>
      </div>
    </div>
  );
};

const YourThreads = ({
  data,
  path,
}: Readonly<{ data: SidebarData; path: string | null }>) => {
  const headingId = useId();
  const { touched, hidden } = useThreadHistory();
  const viewer = useViewerDay(data.renderedAt);
  const merged = useMemo(
    () => mergeRecentThreads(data.threads, touched, hidden),
    [data.threads, touched, hidden],
  );
  const openId = threadIdOfPath(path);

  const body = (): ReactNode => {
    if (!data.signedIn) {
      return data.slots.signIn === null ? null : (
        <div className="flex flex-col items-start gap-2 px-2.5 text-sm">
          <p className="text-muted-foreground">{SIDEBAR_COPY.signIn}</p>
          {data.slots.signIn}
        </div>
      );
    }
    if (data.vaultLocked) {
      return (
        <p className="text-muted-foreground px-2.5 text-sm">{SIDEBAR_COPY.locked}</p>
      );
    }
    if (merged.length === 0) {
      return <p className="text-muted-foreground px-2.5 text-sm">{SIDEBAR_COPY.empty}</p>;
    }
    return groupByDay(merged, viewer).map((group) => {
      const groupId = `${headingId}-${group.label.replace(" ", "-")}`;
      return (
        <div key={group.label} className="mb-4">
          <h3 id={groupId} className="text-muted-foreground px-2.5 pb-1 text-xs">
            {group.label}
          </h3>
          <ul aria-labelledby={groupId} className="flex flex-col">
            {group.threads.map((thread) => (
              <li key={thread.id}>
                <Link
                  href={`/t/${encodeURIComponent(thread.id)}`}
                  className="nav-link gap-2 py-1.5"
                  aria-current={thread.id === openId ? "page" : undefined}
                >
                  <span className="min-w-0 flex-1 truncate">
                    {thread.title.trim() === "" ? "Thread" : thread.title}
                  </span>
                  <span className="text-muted-foreground shrink-0 font-mono text-xs">
                    <span className="sr-only">, </span>
                    {modelCountText(thread.modelCount, (value) => formatNumber(value, 0))}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      );
    });
  };

  return (
    <section
      aria-labelledby={headingId}
      className="border-border mx-3 min-h-0 flex-1 overflow-y-auto border-t pt-4 pb-2"
    >
      <div className="mb-3 flex items-center justify-between px-2.5">
        <h2 id={headingId} className="text-eyebrow">
          Your threads
        </h2>
        {data.signedIn && (
          <Link
            href="/"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 rounded-sm text-xs"
          >
            <PlusIcon className="size-3.5" />
            New
          </Link>
        )}
      </div>
      {body()}
    </section>
  );
};
