"use client";

import {
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

import { CrossGlyph, SidebarGlyph } from "./glyphs";
import { NavPanel } from "./nav-panel";
import { type DataResidency, ResearchFooter } from "./research-footer";
import {
  isSidebarShortcut,
  PEEK_GRACE_MS,
  PEEK_REACH_PX,
  sidebarCookie,
  sidebarReducer,
} from "./sidebar-state";
import { ThreadBar } from "./thread-bar";
import type { ThreadGroup } from "./thread-list";

/**
 * The frame around every shell page. There is no header bar: each page's own
 * heading leads, and a saved thread gets a slim title row (`thread-bar.tsx`).
 *
 * From `lg` up the sidebar is either pinned, a column beside the page, or
 * tucked away behind a floating button. Tucked away, pointing at the button or
 * the left edge shows it over the page, and moving off it hides it again; a
 * click on the button pins it (`sidebar-state.ts` holds the rules). Below
 * `lg` the same button opens the panel as a native modal `<dialog>`: the
 * browser keeps focus inside it, closes it on Escape and makes the page behind
 * it inert, so none of that is hand-built. What is left here is the backdrop
 * click, the scroll lock and putting focus back on the button afterwards.
 */

const WIDE = "(min-width: 64rem)";

/** True from `lg` up, where the sidebar can be pinned or peek. */
const useWide = (): boolean => {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const query = window.matchMedia(WIDE);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return wide;
};

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
  initialPinned = false,
  children,
}: Readonly<{
  threadGroups: readonly ThreadGroup[];
  navFooter: ReactNode;
  residency?: DataResidency;
  /** The pinned choice from the cookie, so the server renders the right layout. */
  initialPinned?: boolean;
  children: ReactNode;
}>) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebar, dispatch] = useReducer(sidebarReducer, {
    pinned: initialPinned,
    peeking: false,
  });
  const wide = useWide();
  const toggleButton = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stay = useCallback(() => {
    if (leaveTimer.current !== null) clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  }, []);
  const point = useCallback(() => {
    stay();
    if (wide) dispatch("point");
  }, [stay, wide]);
  const leave = useCallback(() => {
    stay();
    leaveTimer.current = setTimeout(() => dispatch("leave"), PEEK_GRACE_MS);
  }, [stay]);
  const toggle = useCallback(() => {
    stay();
    if (wide) dispatch("toggle");
    else setMenuOpen(true);
  }, [stay, wide]);

  useEffect(() => stay, [stay]);

  // While it peeks, the panel closes once the pointer is well clear of it.
  // Following the pointer, rather than the panel's own leave event, also
  // closes it when the pointer jumps off it, which a leave event can miss.
  useEffect(() => {
    if (!sidebar.peeking) return;
    const onMove = (event: PointerEvent) => {
      if (event.clientX > PEEK_REACH_PX) leave();
      else stay();
    };
    window.addEventListener("pointermove", onMove);
    return () => window.removeEventListener("pointermove", onMove);
  }, [sidebar.peeking, leave, stay]);

  // Remember the choice for the next page load; a cookie so the server sees it.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.cookie = sidebarCookie(sidebar.pinned);
  }, [sidebar.pinned]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isSidebarShortcut(event)) {
        event.preventDefault();
        toggle();
      } else if (event.key === "Escape") {
        dispatch("escape");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const pinned = wide && sidebar.pinned;
  const peeking = wide && !sidebar.pinned && sidebar.peeking;
  const toggleLabel = !wide
    ? "Open navigation"
    : sidebar.pinned
      ? "Hide sidebar"
      : "Keep sidebar open";

  const pinButton = (
    <button
      type="button"
      aria-label={sidebar.pinned ? "Hide sidebar" : "Keep sidebar open"}
      title={`${sidebar.pinned ? "Hide sidebar" : "Keep sidebar open"} (Ctrl+.)`}
      onClick={toggle}
      className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-lg p-2"
    >
      <SidebarGlyph className="size-4" />
    </button>
  );

  return (
    <div
      data-sidebar={sidebar.pinned ? "pinned" : "tucked"}
      className={`grid h-dvh grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)] ${sidebar.pinned ? "lg:grid-cols-[16rem_minmax(0,1fr)]" : ""}`}
    >
      <a
        href="#main"
        className="bg-background border-border fixed top-3 left-3 z-50 -translate-y-24 rounded-lg border px-3 py-2 text-sm focus:translate-y-0"
      >
        Skip to content
      </a>
      {sidebar.pinned && (
        <div className="border-border bg-muted/40 hidden min-h-0 border-r lg:block">
          <NavPanel
            threadGroups={threadGroups}
            footer={navFooter}
            headerAction={pinButton}
          />
        </div>
      )}
      <button
        ref={toggleButton}
        type="button"
        aria-label={toggleLabel}
        aria-expanded={wide ? peeking : menuOpen}
        title={wide ? `${toggleLabel} (Ctrl+.)` : toggleLabel}
        onClick={toggle}
        onPointerEnter={point}
        onPointerLeave={leave}
        className="shell-toggle"
      >
        <SidebarGlyph className="size-[1.125rem]" />
      </button>
      {!pinned && (
        <div aria-hidden="true" className="shell-edge" onPointerEnter={point} />
      )}
      {peeking && (
        <div className="shell-peek" onPointerEnter={stay} onPointerLeave={leave}>
          <NavPanel
            threadGroups={threadGroups}
            footer={navFooter}
            headerAction={pinButton}
            onNavigate={() => dispatch("navigate")}
          />
        </div>
      )}
      <PhoneMenu
        open={menuOpen}
        onClosed={() => setMenuOpen(false)}
        returnFocusTo={toggleButton}
      >
        <NavPanel
          threadGroups={threadGroups}
          footer={navFooter}
          onNavigate={() => setMenuOpen(false)}
        />
      </PhoneMenu>
      <div className="grid min-h-0 min-w-0 grid-cols-[minmax(0,1fr)] grid-rows-[minmax(0,1fr)_auto]">
        <main
          id="main"
          className="shell-main relative flex min-w-0 flex-col overflow-y-auto"
        >
          <ThreadBar />
          {children}
        </main>
        <ResearchFooter residency={residency} />
      </div>
    </div>
  );
};
