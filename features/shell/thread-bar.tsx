"use client";

import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { useEffect, useState } from "react";

import { useThreadHistory } from "@/infrastructure/thread-history-store";
import { Button } from "@/infrastructure/ui-kit/button";

import { CopyGlyph, TickGlyph } from "./glyphs";
import { threadCrumb } from "./thread-crumb";
import { useThreadTitle } from "./thread-title";

/**
 * The slim row at the top of a saved thread: its title and a button that
 * copies its address. Other pages have no bar; their own heading leads.
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

export const isThreadPath = (pathname: string): boolean => pathname.startsWith("/t/");

export const ThreadBarView = ({
  pathname,
  title,
}: Readonly<{ pathname: string; title?: string }>) => {
  if (!isThreadPath(pathname)) return null;
  const crumb = threadCrumb(title);
  return (
    <div className="thread-bar">
      <p
        className="text-muted-foreground min-w-0 flex-1 truncate text-sm"
        title={crumb.full}
      >
        {crumb.label}
      </p>
      <CopyLinkButton />
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
  return <ThreadBarView pathname={pathname} title={title} />;
};
