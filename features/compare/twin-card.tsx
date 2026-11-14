"use client";

import dynamic from "next/dynamic";
import { useId, useMemo, useState, useSyncExternalStore } from "react";

import { DEMO_SUBJECT_ID } from "@/features/digital-twin/demo-subject";
import { focusOfPick, type TwinFocusId } from "@/packages/anatomy/twin-focus";
import { ChevronIcon, CrossIcon } from "@/infrastructure/ui-kit/icons";

/**
 * The `/twin` card (SPEC 7.7): the Body twin viewer as an item in the
 * conversation. It never reaches a model. The viewer loads lazily; the
 * thread's subject is found from its prompts before the viewer starts on it.
 * A click on an organ tells the screen, so the next turn's on-screen context
 * names it.
 */

export const TWIN_CARD_LABEL = "Digital twin";
export const TWIN_LOADING = "Loading the digital twin…";
export const TWIN_FINDING = "Finding the thread's subject…";

const BodyLoopAvatar = dynamic(
  () =>
    import("@/features/digital-twin/bodyloop-avatar").then((mod) => mod.BodyLoopAvatar),
  { ssr: false, loading: () => <p className="compare-twin-status">{TWIN_LOADING}</p> },
);

const SUBJECT_REF = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i;

type Subject = Readonly<{ subjectId?: string; personRef?: string }>;

/**
 * The subject the card starts on: in synthetic mode the Demo, on the
 * synthetic person the thread asked about (the last prompt naming one);
 * in personal mode the viewer's own default.
 */
export const threadSubject = (
  dataMode: "synthetic" | "personal",
  prompts: readonly string[],
): Subject => {
  if (dataMode === "personal") return {};
  const named = [...prompts].reverse().flatMap((prompt) => {
    const match = SUBJECT_REF.exec(prompt);
    return match === null ? [] : [match[0].toLowerCase()];
  });
  return named[0] === undefined
    ? { subjectId: DEMO_SUBJECT_ID }
    : { subjectId: DEMO_SUBJECT_ID, personRef: named[0] };
};

const noSubscription = (): (() => void) => () => undefined;

const CloseButton = ({ onClose }: Readonly<{ onClose: () => void }>) => (
  <button
    type="button"
    aria-label="Close the digital twin"
    onClick={onClose}
    className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-full p-1.5"
  >
    <CrossIcon />
  </button>
);

export const TwinCard = ({
  threadId,
  dataMode,
  bodyLoopConfigured,
  prompts,
  onClose,
  onOrganPick,
}: Readonly<{
  threadId: string | null;
  dataMode: "synthetic" | "personal";
  bodyLoopConfigured: boolean;
  prompts: readonly string[];
  onClose: () => void;
  onOrganPick?: (organ: TwinFocusId) => void;
}>) => {
  const bodyId = useId();
  const headingId = useId();
  const [open, setOpen] = useState(true);
  const promptKey = prompts.join("\n");
  // The subject is found in the browser; the server's render says so.
  const inBrowser = useSyncExternalStore(
    noSubscription,
    () => true,
    () => false,
  );
  const subject = useMemo<Subject | null>(
    () =>
      inBrowser
        ? threadSubject(dataMode, promptKey === "" ? [] : promptKey.split("\n"))
        : null,
    [dataMode, promptKey, inBrowser],
  );

  return (
    <section
      aria-labelledby={headingId}
      className={open ? "surface compare-twin-card" : "compare-twin-chip"}
    >
      {open ? (
        <header className="flex items-center gap-2 px-4 py-2.5">
          <h3 id={headingId} className="min-w-0 flex-1 truncate text-sm font-medium">
            {TWIN_CARD_LABEL}
          </h3>
          <button
            type="button"
            aria-expanded
            aria-controls={bodyId}
            aria-label="Collapse the digital twin"
            onClick={() => setOpen(false)}
            className="text-muted-foreground hover:text-foreground hover:bg-muted rounded-full p-1.5"
          >
            <ChevronIcon className="rotate-90" />
          </button>
          <CloseButton onClose={onClose} />
        </header>
      ) : (
        <>
          <h3 id={headingId} className="sr-only">
            {TWIN_CARD_LABEL}
          </h3>
          <button
            type="button"
            className="compare-twin-chip-open"
            aria-expanded={false}
            aria-controls={bodyId}
            onClick={() => setOpen(true)}
          >
            <ChevronIcon />
            <span className="truncate">{TWIN_CARD_LABEL}</span>
          </button>
          <CloseButton onClose={onClose} />
        </>
      )}
      {/* Kept mounted while collapsed, so the 3D view does not load again. */}
      <div id={bodyId} hidden={!open} className="compare-twin-body">
        {subject === null ? (
          <p className="compare-twin-status">{TWIN_FINDING}</p>
        ) : (
          <BodyLoopAvatar
            key={threadId ?? "new"}
            bodyLoopConfigured={bodyLoopConfigured}
            {...(subject.subjectId === undefined
              ? {}
              : { initialSubjectId: subject.subjectId })}
            {...(subject.personRef === undefined
              ? {}
              : { initialPersonRef: subject.personRef })}
            onPickPart={(part) => {
              if (part === null || onOrganPick === undefined) return;
              const focus = focusOfPick(part.group, part.system);
              if (focus !== null) onOrganPick(focus);
            }}
          />
        )}
      </div>
    </section>
  );
};
