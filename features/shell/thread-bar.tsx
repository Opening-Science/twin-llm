"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import posthog from "posthog-js";
import { type KeyboardEvent, type ReactNode, useEffect, useState } from "react";

import { threadExportHref } from "@/infrastructure/shell-links";
import { useThreadHistory } from "@/infrastructure/thread-history-store";
import { Button, buttonClassName } from "@/infrastructure/ui-kit/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";
import { isSoftHidden } from "@/infrastructure/ui-kit/soft-delete";
import { UndoButton } from "@/infrastructure/ui-kit/undo-button";
import { useSoftDelete } from "@/infrastructure/ui-kit/use-soft-delete";

import { CopyGlyph, DownloadGlyph, MoreGlyph, TickGlyph } from "./glyphs";
import { menuFocusIndex } from "./menu-focus";
import { threadCrumb, threadSection } from "./thread-crumb";
import { useThreadTitle } from "./thread-title";

/**
 * The slim row at the top of a saved thread: where it belongs and its title
 * ("Chat / …", "Twin / …"), a button that copies
 * its address, a link that downloads it as Markdown and Delete. Other pages
 * have no bar; their own heading leads.
 *
 * Below the `md` breakpoint the four actions fold into one menu (#378).
 *
 * Delete takes the thread out of the sidebar at once and becomes Undo for
 * five seconds; the server deletes it only when that time runs out, and the
 * page then goes to a new chat. Going to another page first deletes it then;
 * closing the tab first makes the browser ask, and leaving keeps the thread
 * (`infrastructure/ui-kit/soft-delete.ts`).
 *
 * The copied link opens only for the thread's owner (`owned-thread.ts`), so
 * it is a way back to your own thread on another tab or device, not a way to
 * share it. The analytics event carries no thread id, for the same reason the
 * page is owner-only.
 */

const COPIED_FOR_MS = 2000;

const PILL = "text-muted-foreground hover:text-foreground shrink-0 py-1.5";

/** One row of the narrow-screen menu: full width, text on the left. */
const MENU_ITEM =
  "text-foreground hover:bg-muted w-full justify-start rounded-md border-transparent px-3 py-2 text-sm";

const CopyLinkButton = ({ className = PILL }: Readonly<{ className?: string }>) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => clearTimeout(timer);
  }, [copied]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      posthog.capture("thread_link_copied");
    } catch (error) {
      console.error("[shell] could not copy the thread link", error);
    }
  };

  return (
    <Button
      variant="pill"
      size="sm"
      onClick={() => void copy()}
      title="Copy this thread's address. Only you can open it."
      className={className}
    >
      {copied ? <TickGlyph className="size-3.5" /> : <CopyGlyph className="size-3.5" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
    </Button>
  );
};

const ExportLinks = ({
  threadId,
  className = PILL,
  onPick,
}: Readonly<{ threadId: string; className?: string; onPick?: () => void }>) => (
  <>
    <a
      href={threadExportHref(threadId, "print")}
      target="_blank"
      rel="noopener"
      title="Open this thread for printing or saving as PDF."
      className={buttonClassName({ variant: "pill", size: "sm", className })}
      onClick={onPick}
    >
      <span>PDF</span>
    </a>
    <a
      href={threadExportHref(threadId)}
      download
      title="Download this thread as Markdown: prompts, lookups and answers."
      className={buttonClassName({ variant: "pill", size: "sm", className })}
      onClick={onPick}
    >
      <DownloadGlyph className="size-3.5" />
      <span>Download</span>
    </a>
  </>
);

const focusables = (panel: EventTarget | null): HTMLElement[] =>
  panel instanceof HTMLElement
    ? Array.from(panel.querySelectorAll<HTMLElement>("a[href], button:not([disabled])"))
    : [];

const deleteFailure = async (threadId: string): Promise<string | null> => {
  const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
  });
  return response.ok ? null : "This thread could not be deleted. Try again.";
};

/** What the layout needs to draw Delete in either place. */
type DeleteSlot = Readonly<{
  button: (className: string) => ReactNode;
  error: ReactNode;
  /** The undo window or the request is running: the menu must stay open. */
  busy: boolean;
}>;

/**
 * Below `md` the actions sit in one menu behind a "…" button, so a long
 * title only ever truncates (#378). Both layouts are in the page and CSS
 * shows one; the menu's panel exists only while it is open.
 *
 * The menu holds itself open while a Delete is waiting out its undo window:
 * closing it would take Undo away, and unmounting the button would stop its
 * clock. Escape then means Undo, as it does on the button itself.
 */
const ThreadActions = ({
  threadId,
  remove,
}: Readonly<{ threadId: string; remove?: DeleteSlot }>) => {
  const [open, setOpen] = useState(false);
  const busy = remove?.busy ?? false;
  const close = () => setOpen(false);

  const moveFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = focusables(event.currentTarget);
    const current = items.findIndex((item) => item === document.activeElement);
    const next = menuFocusIndex(current, items.length, event.key);
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <>
      <div className="hidden shrink-0 items-center gap-3 md:flex">
        <ExportLinks threadId={threadId} />
        <CopyLinkButton />
        {remove?.button(PILL)}
        {remove?.error}
      </div>
      <div className="shrink-0 md:hidden">
        <Popover open={open} onOpenChange={(next) => setOpen(next || busy)}>
          <PopoverTrigger
            aria-label="Thread actions"
            title="Thread actions: PDF, Download, Copy link and Delete."
            className={buttonClassName({ variant: "pill", size: "sm", className: PILL })}
          >
            <MoreGlyph className="size-4" />
          </PopoverTrigger>
          <PopoverContent
            align="end"
            collisionPadding={16}
            aria-label="Thread actions"
            className="flex w-48 flex-col gap-0.5 p-1.5"
            onKeyDown={moveFocus}
            onOpenAutoFocus={(event) => {
              // Start on the first item, whatever Radix would pick.
              event.preventDefault();
              focusables(event.currentTarget)[0]?.focus();
            }}
          >
            <ExportLinks threadId={threadId} className={MENU_ITEM} onPick={close} />
            <CopyLinkButton className={MENU_ITEM} />
            {remove?.button(MENU_ITEM)}
            {remove?.error}
          </PopoverContent>
        </Popover>
      </div>
    </>
  );
};

const DeletableThreadActions = ({ threadId }: Readonly<{ threadId: string }>) => {
  const router = useRouter();
  const { setThreadHidden } = useThreadHistory();
  const { phase, error, controls } = useSoftDelete(async () => {
    const failed = await deleteFailure(threadId);
    if (failed !== null) {
      setThreadHidden(threadId, false);
      return failed;
    }
    // Only when this thread is still the open page; leaving early lands elsewhere.
    if (window.location.pathname === `/t/${threadId}`) router.push("/");
    router.refresh();
    return null;
  });
  const remove: DeleteSlot = {
    busy: phase === "pending" || phase === "deleting",
    button: (className) => (
      <UndoButton
        label="Delete"
        actedText="Thread deleted."
        variant="pill"
        size="sm"
        className={className}
        disabled={phase === "deleting" || phase === "deleted"}
        onAct={() => {
          setThreadHidden(threadId, true);
          controls.act();
        }}
        onUndo={() => {
          setThreadHidden(threadId, false);
          controls.undo();
        }}
        onExpire={controls.expire}
      />
    ),
    error:
      error !== null && !isSoftHidden(phase) ? (
        <p role="alert" className="text-destructive shrink-0 px-1 text-xs">
          {error}
        </p>
      ) : null,
  };
  return <ThreadActions threadId={threadId} remove={remove} />;
};

export const isThreadPath = (pathname: string): boolean => pathname.startsWith("/t/");

export const ThreadBarView = ({
  pathname,
  title,
  deletable = false,
}: Readonly<{ pathname: string; title?: string; deletable?: boolean }>) => {
  if (!isThreadPath(pathname)) return null;
  const threadId = pathname.slice("/t/".length);
  const placed = threadSection(title);
  const crumb = threadCrumb(placed.title);
  return (
    <div className="thread-bar">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-sm"
      >
        <Link
          href={placed.section.href}
          className="text-muted-foreground hover:text-foreground shrink-0"
        >
          {placed.section.label}
        </Link>
        <span aria-hidden="true" className="text-muted-foreground">
          /
        </span>
        <p className="min-w-0 truncate" title={crumb.full}>
          {crumb.label}
        </p>
      </nav>
      {deletable ? (
        <DeletableThreadActions key={threadId} threadId={threadId} />
      ) : (
        <ThreadActions threadId={threadId} />
      )}
    </div>
  );
};

export const ThreadBar = () => {
  const pathname = usePathname();
  const { touched } = useThreadHistory();
  // A thread started in this tab has no server-rendered title yet; the note
  // the compare screen left for the sidebar has it.
  const title =
    useThreadTitle(pathname) ??
    touched.find((thread) => pathname === `/t/${thread.id}`)?.title;
  return <ThreadBarView pathname={pathname} title={title} deletable />;
};
