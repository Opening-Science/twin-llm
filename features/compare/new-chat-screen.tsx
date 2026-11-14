"use client";

import { usePathname } from "next/navigation";
import { useState } from "react";

import { CompareScreen, type CompareScreenProps } from "./compare-screen";
import { nextGeneration } from "./screen-rules";

/**
 * A new chat at `/` (SPEC 7.9). The first send moves the address to
 * `/t/<id>` without a navigation, so the open streams survive. Arriving at
 * `/` again from any other path (sidebar New, the logo, search) always shows
 * an empty conversation: each arrival is a new generation of the screen.
 * Answers still streaming in the previous one are left to finish on the
 * server and show when that thread is reopened.
 */

export type NewChatScreenProps = Omit<CompareScreenProps, "threadId" | "initialTurns">;

export const NewChatScreen = (props: NewChatScreenProps) => {
  const pathname = usePathname();
  const [seenPath, setSeenPath] = useState(pathname);
  const [generation, setGeneration] = useState(0);
  if (seenPath !== pathname) {
    setSeenPath(pathname);
    setGeneration(nextGeneration(generation, seenPath, pathname));
  }
  return <CompareScreen key={generation} {...props} />;
};
