"use client";

import { type ReactNode, type RefObject, useEffect, useRef, useState } from "react";

import { CrossGlyph } from "./glyphs";
import { NavPanel } from "./nav-panel";
import { PageHeader } from "./page-header";
import { type DataResidency, ResearchFooter } from "./research-footer";
import type { ThreadGroup } from "./thread-list";

/**
 * The frame around every shell page. From `lg` up the navigation is a fixed
 * column. Below it, the same panel opens from the header's menu button as a
 * native modal `<dialog>`: the browser keeps focus inside it, closes it on
 * Escape and makes the page behind it inert, so none of that is hand-built.
 * What is left here is the backdrop click, the scroll lock and putting focus
 * back on the menu button afterwards.
 */

const PhoneMenu = ({
  open,
  onClosed,
  returnFocusTo,
  children,
}: Readonly<{
  open: boolean;
  onClosed: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  children: ReactNode;
}>) => {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    element.showModal();
    const { overflow } = document.documentElement.style;
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.documentElement.style.overflow = overflow;
      if (element.open) element.close();
    };
  }, [open]);

  return (
    // The click handler only catches backdrop clicks; keyboard users close the
    // dialog with Escape, which the browser handles.
    // eslint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={dialog}
      aria-label="Navigation"
      onClose={() => {
        onClosed();
        returnFocusTo.current?.focus();
      }}
      // A click on the dialog box itself, outside the panel, is a click on the backdrop.
      onClick={(event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
      }}
      className="bg-background border-border m-0 h-dvh max-h-none w-72 max-w-[85vw] border-r p-0 backdrop:bg-black/40 lg:hidden"
    >
      <div className="relative h-full">
        <form method="dialog" className="absolute top-4 right-3 z-10">
          <button
            aria-label="Close navigation"
            className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg p-2"
          >
            <CrossGlyph className="size-4" />
          </button>
        </form>
        {open && children}
      </div>
    </dialog>
  );
};

export const ShellFrame = ({
  threadGroups,
  navFooter,
  residency,
  children,
}: Readonly<{
  threadGroups: readonly ThreadGroup[];
  navFooter: ReactNode;
  residency?: DataResidency;
  children: ReactNode;
}>) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  return (
    <div className="grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] lg:grid-cols-[16rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="bg-background border-border fixed top-3 left-3 z-50 -translate-y-24 rounded-lg border px-3 py-2 text-sm focus:translate-y-0"
      >
        Skip to content
      </a>
      <div className="border-border bg-muted/40 hidden min-h-0 border-r lg:block">
        <NavPanel threadGroups={threadGroups} footer={navFooter} />
      </div>
      <PhoneMenu
        open={menuOpen}
        onClosed={() => setMenuOpen(false)}
        returnFocusTo={menuButton}
      >
        <NavPanel
          threadGroups={threadGroups}
          footer={navFooter}
          onNavigate={() => setMenuOpen(false)}
        />
      </PhoneMenu>
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[auto_minmax(0,1fr)_auto]">
        <PageHeader onOpenMenu={() => setMenuOpen(true)} menuButtonRef={menuButton} />
        <main id="main" className="relative flex min-w-0 flex-col overflow-y-auto">
          {children}
        </main>
        <ResearchFooter residency={residency} />
      </div>
    </div>
  );
};
