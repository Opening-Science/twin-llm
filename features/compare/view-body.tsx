"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";

import type { InitialFocus, PickedPart } from "@/features/digital-twin/bodyloop-avatar";
import { DEMO_SUBJECT_ID } from "@/features/digital-twin/demo-subject";
import type { TwinBodySpec } from "@/infrastructure/chat-view";
import {
  focusDepth,
  focusHighlights,
  focusOfPick,
  twinFocus,
  type TwinFocusId,
} from "@/packages/anatomy/twin-focus";

/**
 * The body twin focused on the view's organ or system (SPEC 5.5). The 3D
 * viewer loads only in the browser, when the view is drawn. A click on an
 * organ tells the screen, so the next turn's on-screen context names it.
 * The organs' range positions are also listed in words under it.
 */

const Avatar = dynamic(
  () =>
    import("@/features/digital-twin/bodyloop-avatar").then((mod) => mod.BodyLoopAvatar),
  {
    ssr: false,
    loading: () => (
      <p className="text-muted-foreground py-6 text-sm" role="status">
        Loading the digital twin…
      </p>
    ),
  },
);

const POSITION_WORDS = {
  below: "below the range",
  within: "within the range",
  above: "above the range",
} as const;

/** "Liver: within the range (ALT)". */
export const organLine = (organ: TwinBodySpec["organs"][number]): string =>
  `${organ.label}: ${POSITION_WORDS[organ.position]} (${organ.marker})`;

export const BodyView = ({
  spec,
  onOrganPick,
}: Readonly<{ spec: TwinBodySpec; onOrganPick?: (organ: TwinFocusId) => void }>) => {
  const focus = useMemo<InitialFocus>(() => {
    const named = twinFocus(spec.focus);
    return {
      id: named.id,
      label: named.label,
      highlights: focusHighlights(spec.focus),
      depth: focusDepth(spec.focus),
    };
  }, [spec.focus]);
  const demo = spec.body === "demo";
  return (
    <div className="flex flex-col gap-2">
      <div className="h-[min(380px,60vh)] overflow-hidden">
        <Avatar
          initialFocus={focus}
          {...(demo ? { initialSubjectId: DEMO_SUBJECT_ID } : {})}
          {...(demo && spec.subject !== null ? { initialPersonRef: spec.subject } : {})}
          bodyLoopConfigured={!demo}
          onPickPart={(part: PickedPart | null) => {
            if (part === null || onOrganPick === undefined) return;
            const picked = focusOfPick(part.group, part.system);
            if (picked !== null) onOrganPick(picked);
          }}
        />
      </div>
      {spec.organs.length === 0 ? null : (
        <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
          {spec.organs.map((organ) => (
            <li key={`${organ.organ}-${organ.marker}`}>{organLine(organ)}</li>
          ))}
        </ul>
      )}
    </div>
  );
};
