"use client";

import { useRouter } from "next/navigation";

import {
  INCOGNITO_BANNER,
  INCOGNITO_HREF,
  INCOGNITO_TOGGLE_LABEL,
  NEW_CHAT_HREF,
} from "@/infrastructure/incognito";

/**
 * A conversation with no turns (SPEC 2.2): the heading, one paragraph, and
 * on a new chat the incognito toggle. Switching always starts an empty
 * conversation, because the page keys the screen on the mode.
 */

export const EMPTY_LINE =
  "Ask a research question, optionally with your wearable context. Up to three open models answer side by side; open any answer for its reasoning and the metrics it cited. For research and visualisation only.";

export const incognitoTooltip = (incognito: boolean): string =>
  incognito ? "End the incognito chat" : "Start an incognito chat";

/** The calm banner of an incognito chat; it stays above the answers once there are some. */
export const IncognitoBanner = () => (
  <p className="compare-incognito-banner">
    <IncognitoMark className="mt-0.5 size-4 shrink-0" />
    <span>{INCOGNITO_BANNER}</span>
  </p>
);

const IncognitoMark = ({ className }: Readonly<{ className?: string }>) => (
  <svg
    viewBox="0 0 20 20"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.6}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    focusable="false"
    className={className}
  >
    <path d="M3 9h14M5 9l1.5-4.5h7L15 9" />
    <circle cx="6.5" cy="13" r="2.2" />
    <circle cx="13.5" cy="13" r="2.2" />
    <path d="M8.7 13h2.6" />
  </svg>
);

export const IncognitoToggle = ({ incognito }: Readonly<{ incognito: boolean }>) => {
  const router = useRouter();
  const tooltip = incognitoTooltip(incognito);
  return (
    <button
      type="button"
      aria-pressed={incognito}
      aria-label={INCOGNITO_TOGGLE_LABEL}
      title={tooltip}
      onClick={() => router.push(incognito ? NEW_CHAT_HREF : INCOGNITO_HREF)}
      className="compare-incognito-toggle text-muted-foreground hover:text-foreground hover:bg-muted inline-flex size-9 items-center justify-center rounded-full transition-colors"
    >
      <IncognitoMark className="size-5" />
    </button>
  );
};

export const EmptyState = ({
  incognito,
  showToggle,
}: Readonly<{ incognito: boolean; showToggle: boolean }>) => (
  <div className="relative mx-auto flex w-full max-w-2xl flex-col items-center gap-4 pt-[12vh] text-center">
    {showToggle ? (
      <div className="fixed top-2.5 right-4 z-20 sm:right-6">
        <IncognitoToggle incognito={incognito} />
      </div>
    ) : null}
    <h2 className="text-display">TwinLLM</h2>
    <p className="text-muted-foreground max-w-xl text-[15px] leading-relaxed">
      {EMPTY_LINE}
    </p>
    {incognito ? <IncognitoBanner /> : null}
  </div>
);
