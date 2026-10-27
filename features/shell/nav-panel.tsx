"use client";

import { SignInButton } from "@clerk/nextjs";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ComponentType, MouseEvent, ReactNode } from "react";

import { AppAuth, isClientAuthDisabled } from "@/features/auth/app-auth";
import { useThreadHistory } from "@/infrastructure/thread-history-store";
import { Button } from "@/infrastructure/ui-kit/button";

import { useOpenSearch } from "@/features/search/search-context";

import { BrandAttribution } from "./brand-attribution";
import {
  CompareGlyph,
  ConnectorsGlyph,
  DocsGlyph,
  ModelsGlyph,
  PlusGlyph,
  SearchGlyph,
  StartGlyph,
  TwinGlyph,
} from "./glyphs";
import { modelCountLabel, type ThreadGroup, withTouchedThreads } from "./thread-list";

/**
 * What the sidebar and the phone menu both show: where you can go, and the
 * threads you have written, newest first.
 *
 * Links mark themselves with `aria-current`, and the highlight is styled off
 * that attribute, so what a screen reader is told and what is drawn come from
 * one place. The phone menu needs to close when any link is followed; one
 * click listener on the panel does that for every link in it.
 */

type Section = Readonly<{
  href: string;
  label: string;
  Glyph: ComponentType<{ className?: string }>;
  /** True when the page at `path` belongs to this section. */
  owns: (path: string) => boolean;
}>;

const under = (prefix: string) => (path: string) =>
  path === prefix || path.startsWith(`${prefix}/`);

const SECTIONS: readonly Section[] = [
  {
    href: "/",
    label: "TwinLLM",
    Glyph: CompareGlyph,
    // The compare screen is both the empty home and every saved thread.
    owns: (path) => path === "/" || under("/t")(path),
  },
  {
    href: "/customize",
    label: "Customize",
    Glyph: ConnectorsGlyph,
    owns: (path) => under("/customize")(path) || under("/customize/connectors")(path),
  },
  {
    href: "/digital-twin",
    label: "Digital Twin",
    Glyph: TwinGlyph,
    owns: under("/digital-twin"),
  },
  { href: "/models", label: "Models", Glyph: ModelsGlyph, owns: under("/models") },
  { href: "/docs", label: "Docs", Glyph: DocsGlyph, owns: under("/docs") },
  { href: "/start", label: "Get started", Glyph: StartGlyph, owns: under("/start") },
];

const LINK =
  "text-muted-foreground hover:bg-muted hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground flex items-center rounded-md px-2.5 py-1.5 text-sm";

/** A thread's row text: its title and, as a separate phrase for screen readers, its model count. */
export const ThreadRowLabel = ({
  title,
  modelCount,
}: Readonly<{ title: string; modelCount: number }>) => (
  <>
    <span className="truncate">{title}</span>
    <span className="metric shrink-0">
      <span className="sr-only">, </span>
      {modelCountLabel(modelCount)}
    </span>
  </>
);

const currentIf = (yes: boolean) => (yes ? ("page" as const) : undefined);

const ThreadBuckets = ({
  groups,
  openPath,
}: Readonly<{ groups: readonly ThreadGroup[]; openPath: string }>) => {
  if (groups.length === 0) {
    return (
      <p className="text-muted-foreground px-2.5 text-sm">
        No threads yet. Your first prompt starts one.
      </p>
    );
  }
  return groups.map(({ label, threads }) => (
    <div key={label} className="mb-4">
      <h3 className="text-muted-foreground px-2.5 pb-1 text-xs">{label}</h3>
      <ul aria-label={label}>
        {threads.map(({ id, title, modelCount }) => (
          <li key={id}>
            <Link
              href={`/t/${id}`}
              aria-current={currentIf(openPath === `/t/${id}`)}
              className={`${LINK} justify-between gap-2`}
            >
              <ThreadRowLabel title={title} modelCount={modelCount} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  ));
};

const SignInNote = () => (
  <div className="flex flex-col items-start gap-3 px-2.5 text-sm">
    <p className="text-muted-foreground">
      Sign in to keep your threads and come back to them.
    </p>
    <SignInButton mode="modal">
      <Button>Sign in</Button>
    </SignInButton>
  </div>
);

export const NavPanel = ({
  threadGroups,
  footer,
  headerAction,
  onNavigate,
}: Readonly<{
  threadGroups: readonly ThreadGroup[];
  footer: ReactNode;
  /** Beside the wordmark: the button that pins or hides the sidebar. */
  headerAction?: ReactNode;
  onNavigate?: () => void;
}>) => {
  const path = usePathname();
  const recent = withTouchedThreads(threadGroups, useThreadHistory().touched);
  const openSearch = useOpenSearch();

  const followLinks = (event: MouseEvent<HTMLDivElement>) => {
    if (
      onNavigate &&
      event.target instanceof Element &&
      event.target.closest("a[href]")
    ) {
      onNavigate();
    }
  };

  return (
    // Not a control: it only hears clicks that reach it from the links inside.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-static-element-interactions
    <div
      onClick={followLinks}
      className="grid h-full grid-cols-[minmax(0,1fr)] grid-rows-[auto_auto_minmax(0,1fr)_auto]"
    >
      <div className="flex items-center justify-between gap-2 pt-3 pr-3 pb-2 pl-5">
        <Link href="/" className="font-display py-2 text-xl tracking-tight">
          TwinLLM
        </Link>
        {headerAction}
      </div>

      <nav aria-label="Sections" className="px-3">
        <button
          type="button"
          onClick={() => {
            onNavigate?.();
            openSearch();
          }}
          className={`${LINK} w-full gap-3 py-2`}
        >
          <SearchGlyph className="size-4 shrink-0" />
          Search
          <kbd className="search-kbd ml-auto">Ctrl K</kbd>
        </button>
        {SECTIONS.map(({ href, label, Glyph, owns }) => (
          <Link
            key={href}
            href={href}
            aria-current={currentIf(owns(path))}
            className={`${LINK} gap-3 py-2`}
          >
            <Glyph className="size-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      <section
        aria-labelledby="your-threads"
        className="border-border mx-3 mt-4 flex min-h-0 flex-col border-t pt-4"
      >
        <header className="flex items-center justify-between px-2.5 pb-3">
          <h2 id="your-threads" className="text-eyebrow">
            Your threads
          </h2>
          <AppAuth>
            {({ isSignedIn }) =>
              isSignedIn ? (
                <Link
                  href="/"
                  className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                >
                  <PlusGlyph className="size-3.5" />
                  New
                </Link>
              ) : null
            }
          </AppAuth>
        </header>
        <div className="min-h-0 overflow-y-auto pb-4">
          <AppAuth>
            {({ isLoaded, isSignedIn }) => {
              if (isSignedIn) return <ThreadBuckets groups={recent} openPath={path} />;
              return isLoaded && !isClientAuthDisabled() ? <SignInNote /> : null;
            }}
          </AppAuth>
        </div>
      </section>

      <footer className="border-border flex items-center gap-2 border-t px-4 py-3">
        <BrandAttribution />
        {footer}
      </footer>
    </div>
  );
};
