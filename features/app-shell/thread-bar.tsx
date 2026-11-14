"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import posthog from "posthog-js";
import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { useThreadHistory } from "@/infrastructure/thread-history-store";
import { Button } from "@/infrastructure/ui-kit/button";
import { TickIcon } from "@/infrastructure/ui-kit/icons";
import {
  DotsIcon,
  DownloadIcon,
  LinkIcon,
  WarningIcon,
} from "@/infrastructure/ui-kit/nav-icons";
import { Popover, PopoverContent, PopoverTrigger } from "@/infrastructure/ui-kit/popover";
import { guardsUnload, isSoftHidden } from "@/infrastructure/ui-kit/soft-delete";
import { UndoButton } from "@/infrastructure/ui-kit/undo-button";
import { useSoftDelete } from "@/infrastructure/ui-kit/use-soft-delete";

import { type ExportFormat, ExportNotice } from "./export-notice";
import { menuKeyTarget } from "./menu-keys";
import { useOpenThread } from "./open-thread";
import { threadCrumb, threadIdOfPath } from "./thread-crumb";

/**
 * The slim bar at the top of a saved thread (`/t/<id>`): where the thread
 * sits, its title, and four actions. From 768px the actions are a row of
 * pills; below, one "…" button opens them as a menu. Every other page has no
 * bar.
 */

export const THREAD_BAR_COPY = {
  pdfTip: "Open a version for printing or saving as PDF, after a check of what it holds",
  downloadTip: "Download the thread as Markdown: prompts, lookups and answers",
  copyTip:
    "Copy this thread's address. Only you can open it: it is a way back, not a share",
  copied: "Copied",
  copyFailed: "Not copied",
  copyFailedLine: "The link could not be copied. Copy it from the address bar instead.",
  deleted: "Thread deleted.",
  deleteFailed: "This thread could not be deleted. Try again.",
  menuTip: "Thread actions: PDF, Download, Copy link, Delete",
} as const;

const COPIED_MS = 2000;
const COPY_FAILED_MS = 5000;

export const ThreadBar = () => {
  const threadId = threadIdOfPath(usePathname());
  if (threadId === null) return null;
  return <ThreadBarFor key={threadId} threadId={threadId} />;
};

type CopyState = "idle" | "copied" | "failed";

const ThreadBarFor = ({ threadId }: Readonly<{ threadId: string }>) => {
  const router = useRouter();
  const open = useOpenThread();
  const { touched, setThreadHidden } = useThreadHistory();
  const title =
    open?.threadId === threadId
      ? open.title
      : (touched.find(({ id }) => id === threadId)?.title ?? null);
  const crumb = threadCrumb(title);

  const [exporting, setExporting] = useState<ExportFormat | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [copy, setCopy] = useState<CopyState>("idle");
  const menu = useRef<HTMLDivElement>(null);

  const commit = useCallback(async (): Promise<string | null> => {
    const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}`, {
      method: "DELETE",
      credentials: "same-origin",
    }).catch(() => null);
    if (response === null || !response.ok) return THREAD_BAR_COPY.deleteFailed;
    if (threadIdOfPath(window.location.pathname) === threadId) router.push("/");
    router.refresh();
    return null;
  }, [threadId, router]);
  const { phase, error, controls } = useSoftDelete(commit);

  // The sidebar and search leave the thread out from the press until a failure.
  useEffect(() => {
    setThreadHidden(threadId, isSoftHidden(phase));
  }, [phase, threadId, setThreadHidden]);

  useEffect(() => {
    if (copy === "idle") return;
    const timer = setTimeout(
      () => setCopy("idle"),
      copy === "copied" ? COPIED_MS : COPY_FAILED_MS,
    );
    return () => clearTimeout(timer);
  }, [copy]);

  const copyLink = () => {
    const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
    if (clipboard === undefined) {
      setCopy("failed");
      return;
    }
    clipboard.writeText(window.location.href).then(
      () => {
        setCopy("copied");
        // No thread id: the event says only that a link was copied.
        if (posthog.__loaded) posthog.capture("thread_link_copied");
      },
      (failure: unknown) => {
        console.warn(
          "[thread-bar] copy failed",
          failure instanceof Error ? failure.name : typeof failure,
        );
        setCopy("failed");
      },
    );
  };

  const pick = (format: ExportFormat) => {
    setMenuOpen(false);
    setExporting(format);
  };

  const busy = phase === "deleting" || phase === "deleted";
  const holdMenu = guardsUnload(phase);

  const actions = (layout: "row" | "menu"): readonly ReactNode[] => {
    const style =
      layout === "row"
        ? ({ variant: "pill", size: "sm", className: "py-1.5" } as const)
        : ({ variant: "ghost", size: "md", className: "thread-menu-item" } as const);
    return [
      <Button
        key="pdf"
        {...style}
        title={THREAD_BAR_COPY.pdfTip}
        onClick={() => pick("print")}
      >
        PDF
      </Button>,
      <Button
        key="download"
        {...style}
        title={THREAD_BAR_COPY.downloadTip}
        onClick={() => pick("markdown")}
      >
        <DownloadIcon className="size-3.5" />
        Download
      </Button>,
      <Button key="copy" {...style} title={THREAD_BAR_COPY.copyTip} onClick={copyLink}>
        {copy === "copied" ? (
          <TickIcon className="size-3.5" />
        ) : copy === "failed" ? (
          <WarningIcon className="text-destructive size-3.5" />
        ) : (
          <LinkIcon className="size-3.5" />
        )}
        <span aria-live="polite">
          {copy === "copied"
            ? THREAD_BAR_COPY.copied
            : copy === "failed"
              ? THREAD_BAR_COPY.copyFailed
              : "Copy link"}
        </span>
      </Button>,
      <UndoButton
        key="delete"
        {...style}
        label="Delete"
        actedText={THREAD_BAR_COPY.deleted}
        onAct={controls.act}
        onUndo={controls.undo}
        onExpire={controls.expire}
        disabled={busy}
      />,
    ];
  };

  const menuKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = [
      ...event.currentTarget.querySelectorAll<HTMLElement>("button:not(:disabled)"),
    ];
    const next = menuKeyTarget(
      event.key,
      items.findIndex((item) => item === document.activeElement),
      items.length,
    );
    if (next === null) return;
    event.preventDefault();
    items[next]?.focus();
  };

  return (
    <div className="thread-bar">
      <nav
        aria-label="Breadcrumb"
        className="flex min-w-0 flex-1 items-center gap-1.5 text-sm"
      >
        <Link
          href={crumb.section.href}
          className="text-muted-foreground hover:text-foreground shrink-0 rounded-sm"
        >
          {crumb.section.label}
        </Link>
        <span aria-hidden="true" className="text-muted-foreground">
          /
        </span>
        <span className="truncate" title={crumb.full}>
          {crumb.title}
        </span>
      </nav>

      {(error !== null || copy === "failed") && (
        <p role="alert" className="text-destructive min-w-0 truncate text-xs">
          {error ?? THREAD_BAR_COPY.copyFailedLine}
        </p>
      )}

      <div className="hidden shrink-0 items-center gap-3 md:flex">{actions("row")}</div>

      <div className="md:hidden">
        <Popover
          open={menuOpen}
          onOpenChange={(next) => {
            // Closing would take Undo away while a delete waits or runs.
            if (!next && holdMenu) return;
            setMenuOpen(next);
          }}
        >
          <PopoverTrigger asChild>
            <Button
              variant="pill"
              size="sm"
              aria-label="Thread actions"
              title={THREAD_BAR_COPY.menuTip}
              className="h-[30px] px-3"
            >
              <DotsIcon />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            ref={menu}
            align="end"
            collisionPadding={16}
            aria-label="Thread actions"
            className="flex w-56 flex-col p-1"
            onOpenAutoFocus={(event) => {
              event.preventDefault();
              menu.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
            }}
            onEscapeKeyDown={(event) => {
              // While Undo is offered, Escape is Undo (the button handles it).
              if (holdMenu) event.preventDefault();
            }}
            onKeyDown={menuKeys}
          >
            {actions("menu")}
          </PopoverContent>
        </Popover>
      </div>

      {exporting !== null && (
        <ExportNotice
          threadId={threadId}
          format={exporting}
          onClose={() => setExporting(null)}
        />
      )}
    </div>
  );
};
