"use client";

import { INCOGNITO_BANNER, INCOGNITO_TOGGLE_LABEL } from "@/infrastructure/incognito";
import { Button } from "@/infrastructure/ui-kit/button";

import { Mark } from "./marks";

/**
 * The incognito switch on an empty new chat, and the banner that says what
 * the mode means (`infrastructure/incognito.ts`). The caller decides what a
 * press does; the compare screen changes the URL (`/?incognito=1` on, `/`
 * off), and the home page keys the screen on the mode, so switching always
 * starts from an empty conversation.
 */

export const IncognitoToggle = ({
  on,
  onToggle,
}: Readonly<{ on: boolean; onToggle: () => void }>) => (
  <Button
    variant="ghost"
    size="sm"
    aria-pressed={on}
    aria-label={INCOGNITO_TOGGLE_LABEL}
    title={on ? "Turn incognito off" : "Start an incognito chat"}
    onClick={onToggle}
    className="incognito-toggle size-8 p-0"
  >
    <Mark name="incognito" className="size-5" />
  </Button>
);

export const IncognitoBanner = () => (
  <p className="incognito-banner">
    <Mark name="incognito" className="mt-px size-4 shrink-0" />
    <span>{INCOGNITO_BANNER}</span>
  </p>
);
