"use client";

import { type ReactNode, type Ref, useId } from "react";

import { Mark } from "./marks";

/**
 * The `/twin` card in the conversation: a header with the twin's label, a
 * collapse button and a close button, and the viewer under it. Collapsed, it
 * is a one-line chip that opens it again. The viewer is passed in, so the
 * chat bundle loads three.js only once the card is open (compare-screen.tsx).
 */

export const TWIN_CARD_REGION = "Digital twin in this chat";
export const TWIN_CARD_NOTE = "Shown in the chat only; no model sees it.";
export const TWIN_COLLAPSE = "Collapse the digital twin";
export const TWIN_EXPAND = "Open the digital twin";
export const TWIN_CLOSE = "Close the digital twin";

const ICON_BUTTON =
  "text-muted-foreground hover:text-foreground hover:bg-muted focus-visible:ring-ring inline-flex size-8 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2";

const Chevron = ({ open }: Readonly<{ open: boolean }>) => (
  <svg
    viewBox="0 0 20 20"
    className={`size-4 transition-transform ${open ? "" : "-rotate-90"}`}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path d="m5 8 5 5 5-5" />
  </svg>
);

export const TwinChatCard = ({
  label,
  collapsed,
  onCollapse,
  onExpand,
  onClose,
  children,
  ref,
}: Readonly<{
  label: string;
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
  onClose: () => void;
  /** The viewer; rendered only while the card is open. */
  children: ReactNode;
  ref?: Ref<HTMLElement>;
}>) => {
  const bodyId = useId();
  return (
    <section
      ref={ref}
      aria-label={TWIN_CARD_REGION}
      tabIndex={-1}
      className={collapsed ? "twin-chat-chip" : "surface twin-chat-card"}
    >
      {collapsed ? (
        <>
          <button
            type="button"
            aria-expanded={false}
            aria-controls={bodyId}
            aria-label={`${TWIN_EXPAND}: ${label}`}
            onClick={onExpand}
            className="twin-chat-chip-open"
          >
            <Chevron open={false} />
            <span className="truncate">{label}</span>
          </button>
          <button
            type="button"
            aria-label={TWIN_CLOSE}
            onClick={onClose}
            className={ICON_BUTTON}
          >
            <Mark name="remove" className="size-3.5" />
          </button>
          <div id={bodyId} hidden />
        </>
      ) : (
        <>
          <div className="border-border flex items-center gap-2 border-b py-1.5 pr-1.5 pl-4">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{label}</p>
              <p className="text-muted-foreground truncate text-xs">{TWIN_CARD_NOTE}</p>
            </div>
            <button
              type="button"
              aria-expanded={true}
              aria-controls={bodyId}
              aria-label={TWIN_COLLAPSE}
              onClick={onCollapse}
              className={ICON_BUTTON}
            >
              <Chevron open={true} />
            </button>
            <button
              type="button"
              aria-label={TWIN_CLOSE}
              onClick={onClose}
              className={ICON_BUTTON}
            >
              <Mark name="remove" className="size-3.5" />
            </button>
          </div>
          <div id={bodyId} className="twin-chat-body">
            {children}
          </div>
        </>
      )}
    </section>
  );
};
