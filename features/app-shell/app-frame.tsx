"use client";

import {
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { CrossIcon } from "@/infrastructure/ui-kit/icons";
import { SidebarIcon } from "@/infrastructure/ui-kit/nav-icons";

import { type SidebarData, SidebarPanel } from "./sidebar-panel";
import {
  PEEK_GRACE_MS,
  PEEK_REACH_PX,
  sidebarCookie,
  sidebarReducer,
} from "./sidebar-state";
import { ThreadBar } from "./thread-bar";

/**
 * The frame every shell page sits in. It fills the viewport exactly; only
 * the main region scrolls. On wide screens (from 1024px) the sidebar is a
 * pinned column or tucked behind a floating button that shows it while the
 * pointer is near; below that the button opens it as a modal menu. The
 * research footer is a row under the page, never over it.
 */

const WIDE = "(min-width: 64rem)";

const subscribeWide = (onChange: () => void) => {
  const query = window.matchMedia(WIDE);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
};

/** False until the browser has said, so the server render and hydration agree. */
const useIsWide = (): boolean =>
  useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );

const PIN_LABEL = { pinned: "Hide sidebar", tucked: "Keep sidebar open" } as const;

export const AppFrame = ({
  initialPinned,
  sidebar,
  footer,
  children,
}: Readonly<{
  initialPinned: boolean;
  sidebar: SidebarData;
  footer: ReactNode;
  children: ReactNode;
}>) => {
  const [state, dispatch] = useReducer(sidebarReducer, {
    pinned: initialPinned,
    peeking: false,
  });
  const wide = useIsWide();
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleButton = useRef<HTMLButtonElement>(null);
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(state.pinned);

  const toggle = useCallback(() => {
    // Written on each change, never on first render.
    document.cookie = sidebarCookie(!pinned.current);
    pinned.current = !pinned.current;
    dispatch("toggle");
  }, []);

  const stay = useCallback(() => {
    if (leaveTimer.current === null) return;
    clearTimeout(leaveTimer.current);
    leaveTimer.current = null;
  }, []);

  const reach = () => {
    stay();
    if (wide) dispatch("reach");
  };

  const away = useCallback(() => {
    if (leaveTimer.current !== null) return;
    leaveTimer.current = setTimeout(() => {
      leaveTimer.current = null;
      dispatch("leave");
    }, PEEK_GRACE_MS);
  }, []);

  useEffect(() => stay, [stay]);

  // A pointer that jumps off the panel can miss its leave event; distance
  // from the left edge catches it.
  const peeking = wide && !state.pinned && state.peeking;
  useEffect(() => {
    if (!peeking) return;
    const onMove = (event: PointerEvent) => {
      if (event.clientX > PEEK_REACH_PX) away();
      else stay();
    };
    document.addEventListener("pointermove", onMove);
    return () => document.removeEventListener("pointermove", onMove);
  }, [peeking, away, stay]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        dispatch("escape");
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      if (event.key !== ".") return;
      event.preventDefault();
      if (window.matchMedia(WIDE).matches) toggle();
      else setMenuOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle]);

  const pinButton = (
    <button
      type="button"
      className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-9 items-center justify-center rounded-lg"
      aria-label={state.pinned ? PIN_LABEL.pinned : PIN_LABEL.tucked}
      title={`${state.pinned ? PIN_LABEL.pinned : PIN_LABEL.tucked} (Ctrl+.)`}
      onClick={toggle}
    >
      <SidebarIcon className="size-[18px]" />
    </button>
  );

  const floatingLabel = wide
    ? state.pinned
      ? PIN_LABEL.pinned
      : PIN_LABEL.tucked
    : "Open navigation";

  return (
    <div className="shell-frame" data-sidebar={state.pinned ? "pinned" : "tucked"}>
      <a href="#main" className="skip-link">
        Skip to content
      </a>

      {state.pinned && (
        <aside className="shell-pinned">
          <SidebarPanel data={sidebar} headerControl={pinButton} />
        </aside>
      )}

      <button
        ref={toggleButton}
        type="button"
        className="shell-toggle"
        aria-label={floatingLabel}
        aria-expanded={wide ? peeking : menuOpen}
        title={wide ? `${floatingLabel} (Ctrl+.)` : floatingLabel}
        onPointerEnter={reach}
        onPointerLeave={away}
        onClick={() => (wide ? toggle() : setMenuOpen(true))}
      >
        <SidebarIcon className="size-[18px]" />
      </button>

      {!state.pinned && (
        <div
          className="shell-edge"
          aria-hidden="true"
          onPointerEnter={reach}
          onPointerLeave={away}
        />
      )}

      {peeking && (
        <aside className="shell-peek" onPointerEnter={reach} onPointerLeave={away}>
          <SidebarPanel
            data={sidebar}
            headerControl={pinButton}
            onFollow={() => dispatch("follow")}
          />
        </aside>
      )}

      <main id="main" tabIndex={-1} className="shell-main">
        <ThreadBar />
        {children}
      </main>

      {footer}

      {menuOpen && (
        <PhoneMenu
          data={sidebar}
          onClose={() => {
            setMenuOpen(false);
            // Back to the button, unless the Search row has already moved focus
            // into the search box.
            const focused = document.activeElement;
            if (focused === null || focused === document.body)
              toggleButton.current?.focus();
          }}
        />
      )}
    </div>
  );
};

/** The sidebar as a modal menu below 1024px. Mounted only while open. */
const PhoneMenu = ({
  data,
  onClose,
}: Readonly<{ data: SidebarData; onClose: () => void }>) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (!element.open) element.showModal();
    // Start on the close button rather than the first link.
    closeButton.current?.focus();
    const onBackdrop = (event: MouseEvent) => {
      if (event.target === element) element.close();
    };
    element.addEventListener("click", onBackdrop);
    return () => element.removeEventListener("click", onBackdrop);
  }, []);

  const close = () => dialog.current?.close();

  return (
    <dialog ref={dialog} aria-label="Navigation" className="shell-menu" onClose={onClose}>
      <SidebarPanel
        data={data}
        onFollow={close}
        headerControl={
          <button
            ref={closeButton}
            type="button"
            aria-label="Close navigation"
            className="text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-9 items-center justify-center rounded-lg"
            onClick={close}
          >
            <CrossIcon className="size-4" />
          </button>
        }
      />
    </dialog>
  );
};
