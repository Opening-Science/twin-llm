"use client";

import { useCallback, useEffect, useReducer, useRef, useSyncExternalStore } from "react";

import { localHour } from "./environment-look";
import {
  closeEnvironment,
  enterFullscreen,
  environmentReducer,
  escapeExits,
  initialEnvironment,
  panelLayout,
  type EnvironmentAction,
  type EnvironmentPanel,
  type EnvironmentState,
} from "./environment-state";
import { installTabTrap } from "./focus-trap";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

const MINUTE_MS = 60_000;

/**
 * The device clock, one value per minute, so the sky redraws once a minute at
 * most. The timer stops while the tab is hidden and catches up on return.
 */
const subscribeMinute = (onChange: () => void) => {
  let timer: number | null = null;
  const start = () => {
    if (timer === null) timer = window.setInterval(onChange, MINUTE_MS);
  };
  const stop = () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  };
  const onVisibility = () => {
    if (document.hidden) {
      stop();
      return;
    }
    onChange();
    start();
  };
  if (!document.hidden) start();
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    stop();
    document.removeEventListener("visibilitychange", onVisibility);
  };
};
const currentMinute = () => Math.floor(Date.now() / MINUTE_MS);
const noMinute = () => null;
const subscribeNever = () => () => undefined;

/**
 * Local hour on this device; never sent anywhere. Null on the server and while
 * disabled, so the inline viewer never re-renders on the minute.
 */
export const useLocalHour = (enabled: boolean): number | null => {
  const minute = useSyncExternalStore(
    enabled ? subscribeMinute : subscribeNever,
    enabled ? currentMinute : noMinute,
    noMinute,
  );
  return minute === null ? null : localHour(new Date(minute * MINUTE_MS));
};

const targetTag = (target: EventTarget | null): string =>
  target instanceof Element ? target.tagName : "";

export type EnvironmentController = Readonly<{
  state: EnvironmentState;
  active: boolean;
  dispatch: (action: EnvironmentAction) => void;
  /** Callback ref for the viewer container; its removal closes the environment. */
  setContainer: (node: HTMLDivElement | null) => void;
  buttonRef: React.RefObject<HTMLButtonElement | null>;
  toggle: () => void;
  togglePanel: (panel: EnvironmentPanel) => void;
  openPanel: (panel: EnvironmentPanel) => void;
}>;

/** Read at the moment of the click, so a rotated phone gets the right rule. */
const onePanelOnly = () => panelLayout(window.innerWidth) === "phone";

export const useEnvironment = (): EnvironmentController => {
  const [state, dispatch] = useReducer(environmentReducer, initialEnvironment);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const wasActive = useRef(false);
  // Bumped on every enter and exit, so a full-screen grant that arrives late is dropped.
  const attemptRef = useRef(0);
  const active = state.mode !== "off";

  const exit = useCallback(() => {
    attemptRef.current += 1;
    dispatch({ type: "exit" });
  }, []);

  // A viewer that unmounts while open (subject switch, lost context, leaving
  // the page) closes the environment, so no scroll lock or listener outlives it.
  const setContainer = useCallback(
    (node: HTMLDivElement | null) => {
      const previous = containerRef.current;
      containerRef.current = node;
      if (node !== null || previous === null) return;
      void closeEnvironment(document, "fullscreen", previous);
      exit();
    },
    [exit],
  );

  const toggle = useCallback(() => {
    const container = containerRef.current;
    if (state.mode !== "off") {
      void closeEnvironment(document, state.mode, container);
      exit();
      return;
    }
    if (!container) return;
    attemptRef.current += 1;
    const attempt = attemptRef.current;
    dispatch({ type: "enter", layout: panelLayout(window.innerWidth) });
    // Called inside the click, so the browser counts it as a user gesture.
    void enterFullscreen(document, container, () => attemptRef.current === attempt).then(
      (outcome) => {
        if (outcome === "fullscreen") dispatch({ type: "fullscreen" });
      },
    );
  }, [state.mode, exit]);

  // The browser leaves full screen on Escape by itself; follow it.
  useEffect(() => {
    if (state.mode !== "fullscreen") return;
    const onChange = () => {
      if (document.fullscreenElement !== containerRef.current) exit();
    };
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, [state.mode, exit]);

  // The overlay is ours: Escape closes it, and the page behind it does not scroll.
  useEffect(() => {
    if (state.mode !== "overlay") return;
    const onKey = (event: KeyboardEvent) => {
      const escape = {
        key: event.key,
        defaultPrevented: event.defaultPrevented,
        targetTag: targetTag(event.target),
      };
      if (escapeExits(escape)) exit();
    };
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [state.mode, exit]);

  // Focus goes back to the button however the environment was left.
  useEffect(() => {
    if (wasActive.current && !active) buttonRef.current?.focus();
    wasActive.current = active;
  }, [active]);

  // Tab cycles inside the environment; the page behind it is covered.
  useEffect(() => {
    const container = containerRef.current;
    if (!active || !container) return;
    return installTabTrap(document, {
      focusables: () =>
        [...container.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
          (element) => element.getClientRects().length > 0,
        ),
      focus: () => container.focus(),
    });
  }, [active]);

  const togglePanel = useCallback(
    (panel: EnvironmentPanel) =>
      dispatch({ type: "toggle", panel, single: onePanelOnly() }),
    [],
  );
  const openPanel = useCallback(
    (panel: EnvironmentPanel) =>
      dispatch({ type: "open", panel, single: onePanelOnly() }),
    [],
  );

  return {
    state,
    active,
    dispatch,
    setContainer,
    buttonRef,
    toggle,
    togglePanel,
    openPanel,
  };
};
