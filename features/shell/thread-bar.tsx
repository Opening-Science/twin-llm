"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useState } from "react";

import { threadExportHref } from "@/infrastructure/shell-links";
import { useThreadHistory } from "@/infrastructure/thread-history-store";
import { Button, buttonClassName } from "@/infrastructure/ui-kit/button";
import { isSoftHidden } from "@/infrastructure/ui-kit/soft-delete";
import { UndoButton } from "@/infrastructure/ui-kit/undo-button";
import { useSoftDelete } from "@/infrastructure/ui-kit/use-soft-delete";

import { CopyGlyph, DownloadGlyph, TickGlyph } from "./glyphs";
import { threadCrumb, threadSection } from "./thread-crumb";
import { useThreadTitle } from "./thread-title";

/**
 * The slim row at the top of a saved thread: where it belongs and its title
 * ("Chat / …", "Twin / …"), a button that copies
 * its address, a link that downloads it as Markdown and Delete. Other pages
 * have no bar; their own heading leads.
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

const CopyLinkButton = () => {
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
      className="text-muted-foreground hover:text-foreground shrink-0 py-1.5"
    >
      {copied ? <TickGlyph className="size-3.5" /> : <CopyGlyph className="size-3.5" />}
      <span aria-live="polite">{copied ? "Copied" : "Copy link"}</span>
    </Button>
  );
};

const PILL = "text-muted-foreground hover:text-foreground shrink-0 py-1.5";

const deleteFailure = async (threadId: string): Promise<string | null> => {
  const response = await fetch(`/api/threads/${encodeURIComponent(threadId)}`, {
    method: "DELETE",
  });
  return response.ok ? null : "This thread could not be deleted. Try again.";
};

const DeleteThreadButton = ({ threadId }: Readonly<{ threadId: string }>) => {
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
  return (
    <>
      <UndoButton
        label="Delete"
        actedText="Thread deleted."
        variant="pill"
        size="sm"
        className={PILL}
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
      {error !== null && !isSoftHidden(phase) && (
        <p role="alert" className="text-destructive shrink-0 text-xs">
          {error}
        </p>
      )}
    </>
  );
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
      <a
        href={threadExportHref(threadId, "print")}
        target="_blank"
        rel="noopener"
        title="Open this thread for printing or saving as PDF."
        className={buttonClassName({
          variant: "pill",
          size: "sm",
          className: "text-muted-foreground hover:text-foreground shrink-0 py-1.5",
        })}
      >
        <span>PDF</span>
      </a>
      <a
        href={threadExportHref(threadId)}
        download
        title="Download this thread as Markdown: prompts, lookups and answers."
        className={buttonClassName({
          variant: "pill",
          size: "sm",
          className: "text-muted-foreground hover:text-foreground shrink-0 py-1.5",
        })}
      >
        <DownloadGlyph className="size-3.5" />
        <span>Download</span>
      </a>
      <CopyLinkButton />
      {deletable && <DeleteThreadButton key={threadId} threadId={threadId} />}
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
