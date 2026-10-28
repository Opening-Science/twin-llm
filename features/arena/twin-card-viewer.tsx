"use client";

import { useCallback } from "react";

import { BodyLoopAvatar, type PickedPart } from "@/features/digital-twin/bodyloop-avatar";
import { DEMO_SUBJECT_ID } from "@/features/digital-twin/demo-subject";
import { type TwinContext } from "@/features/digital-twin/page-sections";
import { focusOfPick } from "@/packages/anatomy/twin-focus";

import { useTwinPick } from "./twin-pick-context";
import { type ShownSubject, type TwinTarget } from "./twin-subject";

/**
 * The Digital Twin page's body viewer inside the `/twin` card, unchanged
 * apart from where it starts: synthetic mode starts on the Demo body (with
 * the thread's synthetic person when there is one), personal mode on the
 * page's own default, Self. Loaded with a dynamic import, so three.js reaches
 * the chat only once a card is open. The card's CSS (`.twin-chat-body` in
 * globals.css) makes it compact. A click on an organ sets the chat's UI
 * context (#47).
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
  const pick = useTwinPick();
  const onPickPart = useCallback(
    (part: PickedPart | null) =>
      pick(part === null ? null : focusOfPick(part.group, part.system)),
    [pick],
  );
  return (
    <BodyLoopAvatar
      onContext={onContext}
      onPickPart={onPickPart}
      initialSubjectId={target.kind === "self" ? undefined : DEMO_SUBJECT_ID}
      initialPersonRef={target.kind === "synthetic" ? target.ref : undefined}
    />
  );
};
