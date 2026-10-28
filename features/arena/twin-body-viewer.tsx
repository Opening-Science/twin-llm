"use client";

import { useCallback } from "react";

import { BodyLoopAvatar, type PickedPart } from "@/features/digital-twin/bodyloop-avatar";
import { DEMO_SUBJECT_ID } from "@/features/digital-twin/demo-subject";
import type { TwinBodySpec } from "@/infrastructure/chat-view";
import { focusOfPick } from "@/packages/anatomy/twin-focus";

import { twinBodyFocus } from "./twin-body-text";
import { useTwinPick } from "./twin-pick-context";

/**
 * The Digital Twin page's body viewer for a `twin.body` view, as the `/twin`
 * card shows it: the Demo body (with the view's synthetic person) or Self,
 * started on the view's focus. A click on an organ sets the chat's UI context.
 * Loaded with a dynamic import, so three.js arrives only once it is opened.
 */
export const TwinBodyViewer = ({ spec }: Readonly<{ spec: TwinBodySpec }>) => {
  const pick = useTwinPick();
  const onPickPart = useCallback(
    (part: PickedPart | null) =>
      pick(part === null ? null : focusOfPick(part.group, part.system)),
    [pick],
  );
  return (
    <BodyLoopAvatar
      initialSubjectId={spec.body === "self" ? undefined : DEMO_SUBJECT_ID}
      initialPersonRef={spec.subject ?? undefined}
      initialFocus={twinBodyFocus(spec)}
      onPickPart={onPickPart}
    />
  );
};
