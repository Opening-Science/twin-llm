"use client";

import dynamic from "next/dynamic";
import { useId, useState } from "react";

import type { TwinBodySpec } from "@/infrastructure/chat-view";
import { Button } from "@/infrastructure/ui-kit/button";

import {
  TWIN_BODY_HIDE,
  TWIN_BODY_NOTE,
  TWIN_BODY_SHOW,
  twinBodyCaption,
  twinBodyEmptyText,
  twinBodyLines,
} from "./twin-body-text";

/** three.js arrives when a twin is opened, not with the answer. */
const TwinBodyViewer = dynamic(
  () => import("./twin-body-viewer").then((mod) => mod.TwinBodyViewer),
  {
    ssr: false,
    loading: () => <p className="twin-chat-status">Loading the digital twin…</p>,
  },
);

/**
 * `twin.body`: the focus and each mapped organ's range position in words, and
 * the body twin on that focus behind a button, so a thread with several twin
 * views starts only the ones someone opens. The viewer is the `/twin` card's.
 */
export const TwinBodyFigure = ({ spec }: Readonly<{ spec: TwinBodySpec }>) => {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const empty = twinBodyEmptyText(spec);
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-xs">{twinBodyCaption(spec)}</p>
      {empty === null ? (
        <ul className="flex flex-col gap-0.5 text-sm">
          {twinBodyLines(spec).map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : (
        <p className="text-muted-foreground text-sm">{empty}</p>
      )}
      <div>
        <Button
          size="sm"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((value) => !value)}
        >
          {open ? TWIN_BODY_HIDE : TWIN_BODY_SHOW}
        </Button>
      </div>
      <div id={bodyId} hidden={!open}>
        {open ? (
          <div className="surface twin-chat-card">
            <p className="text-muted-foreground border-border border-b px-4 py-1.5 text-xs">
              {TWIN_BODY_NOTE}
            </p>
            <div className="twin-chat-body">
              <TwinBodyViewer spec={spec} />
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
};
