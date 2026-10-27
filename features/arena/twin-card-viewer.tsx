"use client";

import { useCallback } from "react";

import { BodyLoopAvatar } from "@/features/digital-twin/bodyloop-avatar";
import { DEMO_SUBJECT_ID } from "@/features/digital-twin/demo-subject";
import { type TwinContext } from "@/features/digital-twin/page-sections";

import { type ShownSubject, type TwinTarget } from "./twin-subject";

/**
 * The Digital Twin page's body viewer inside the `/twin` card, unchanged
 * apart from where it starts: synthetic mode starts on the Demo body (with
 * the thread's synthetic person when there is one), personal mode on the
 * page's own default, Self. Loaded with a dynamic import, so three.js reaches
 * the chat only once a card is open. The card's CSS (`.twin-chat-body` in
 * globals.css) makes it compact.
 */
export const TwinCardViewer = ({
  target,
  onShown,
}: Readonly<{
  target: TwinTarget;
  /** Which subject the viewer settled on, for the card's label. */
  onShown: (shown: ShownSubject) => void;
}>) => {
  const onContext = useCallback(
    (context: TwinContext) => onShown(context.subject),
    [onShown],
  );
  return (
    <BodyLoopAvatar
      onContext={onContext}
      initialSubjectId={target.kind === "self" ? undefined : DEMO_SUBJECT_ID}
      initialPersonRef={target.kind === "synthetic" ? target.ref : undefined}
    />
  );
};
