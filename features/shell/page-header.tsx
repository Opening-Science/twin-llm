"use client";

import { usePathname } from "next/navigation";
import posthog from "posthog-js";
import { type Ref, useEffect, useState } from "react";

import { useThreadHistory } from "@/infrastructure/thread-history-store";
import { Button } from "@/infrastructure/ui-kit/button";

import { CopyGlyph, MenuGlyph, TickGlyph } from "./glyphs";
import { type Crumb, threadCrumb } from "./thread-crumb";
import { useThreadTitle } from "./thread-title";

/**
 * The bar above every shell page: the phone menu button, where you are, and on
 * a thread a button that copies its address.
 *
 * The copied link opens only for the thread's owner (`owned-thread.ts`), so
 * it is a way back to your own thread on another tab or device, not a way to
 * share it. The analytics event carries no thread id, for the same reason the
 * page is owner-only.
 */

const SECTIONS: readonly Readonly<{ prefix: string; label: string }>[] = [
  { prefix: "/connectors", label: "Connectors" },
  { prefix: "/digital-twin", label: "Digital Twin" },
  { prefix: "/data", label: "Data" },
  { prefix: "/models", label: "Models" },
];

const HOME: Crumb = { label: "TwinLLM" };

export const crumbsFor = (pathname: string, title?: string): readonly Crumb[] => {
  if (pathname.startsWith("/t/")) return [HOME, threadCrumb(title)];
  const section = SECTIONS.find(
    ({ prefix }) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  return [section ? { label: section.label } : HOME];
};

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

export const PageHeaderView = ({
  pathname,
  title,
  onOpenMenu,
  menuButtonRef,
}: Readonly<{
  pathname: string;
  title?: string;
  onOpenMenu: () => void;
  menuButtonRef: Ref<HTMLButtonElement>;
}>) => {
  const crumbs = crumbsFor(pathname, title);
  return (
    <header className="border-border bg-background/90 sticky top-0 z-20 flex h-14 items-center gap-3 border-b px-4 backdrop-blur sm:px-6">
      <Button
        ref={menuButtonRef}
        variant="ghost"
        aria-label="Open navigation"
        onClick={onOpenMenu}
        className="hover:bg-muted -ml-1.5 p-2 lg:hidden"
      >
        <MenuGlyph className="size-5" />
      </Button>
      <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
        <ol className="flex min-w-0 items-center gap-2 text-sm">
          {crumbs.map((crumb, index) => {
            const last = index === crumbs.length - 1;
            return (
              <li
                key={index}
                className={
                  last
                    ? "flex min-w-0 items-center gap-2"
                    : "text-muted-foreground hidden items-center gap-2 sm:flex"
                }
              >
                {index > 0 && (
                  <span
                    aria-hidden="true"
                    className="text-muted-foreground hidden sm:inline"
                  >
                    /
                  </span>
                )}
                {last ? (
                  <span className="truncate" aria-current="page" title={crumb.full}>
                    {crumb.label}
                  </span>
                ) : (
                  crumb.label
                )}
              </li>
            );
          })}
        </ol>
      </nav>
      {pathname.startsWith("/t/") && <CopyLinkButton />}
    </header>
  );
};

export const PageHeader = ({
  onOpenMenu,
  menuButtonRef,
}: Readonly<{ onOpenMenu: () => void; menuButtonRef: Ref<HTMLButtonElement> }>) => {
  const pathname = usePathname();
  const { touched } = useThreadHistory();
  // A thread started in this tab has no server-rendered title yet; the note
  // the compare screen left for the sidebar has it.
  const title =
    useThreadTitle(pathname) ??
    touched.find((thread) => pathname === `/t/${thread.id}`)?.title;
  return (
    <PageHeaderView
      pathname={pathname}
      title={title}
      onOpenMenu={onOpenMenu}
      menuButtonRef={menuButtonRef}
    />
  );
};
