"use client";

import { createContext, useContext } from "react";

import type { TwinFocusId } from "@/packages/anatomy/twin-focus";

/**
 * How a twin in the chat (the `/twin` card or a `twin.body` view) tells the
 * compare screen which organ was clicked, so the next turn's UI context names
 * it. Outside the compare screen a click sets nothing.
 */
export const TwinPickContext = createContext<(focus: TwinFocusId | null) => void>(
  () => undefined,
);

export const useTwinPick = () => useContext(TwinPickContext);
