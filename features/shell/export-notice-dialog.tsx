"use client";

import { useEffect, useRef, useState } from "react";

import { parseExportNotice } from "@/features/arena/export-notice";
import { threadExportHref } from "@/infrastructure/shell-links";
import { Button } from "@/infrastructure/ui-kit/button";

/**
 * The notice before a thread export (#531). Picking Download or PDF first
 * asks the server to check the export (`?check=1`); the answer is one plain
 * line, such as "This export contains: 2 lab values. Download anyway?", with
 * Download and Cancel. Nothing is made until Download: only then is the
 * export requested with `?confirm=1`, which the server records. An export
 * the server withholds (the person's own genome identifiers) shows its
 * sentence with Close only. A native modal `<dialog>`, like search: the
 * browser keeps focus inside and Escape cancels.
 */

export type ExportPick = "markdown" | "print";

export type ExportNoticeState =
  | Readonly<{ pick: ExportPick; phase: "checking" }>
  | Readonly<{ pick: ExportPick; phase: "ready" | "refused"; line: string }>
  | Readonly<{ pick: ExportPick; phase: "failed" }>;

export const EXPORT_CHECKING = "Checking this export for stored values…";
export const EXPORT_CHECK_FAILED =
  "This export could not be checked just now, so nothing was made. Try again.";

const hrefOf = (threadId: string, pick: ExportPick, step: "check" | "confirm") =>
  threadExportHref(threadId, pick === "print" ? "print" : undefined, step);

/** Asks for the check; the state the dialog shows next. */
export const checkExport = async (
  threadId: string,
  pick: ExportPick,
  fetchFn: typeof fetch = fetch,
): Promise<ExportNoticeState> => {
  try {
    const response = await fetchFn(hrefOf(threadId, pick, "check"));
    const notice = response.ok ? parseExportNotice(await response.json()) : null;
    return notice === null
      ? { pick, phase: "failed" }
      : { pick, phase: notice.status, line: notice.line };
  } catch {
    return { pick, phase: "failed" };
  }
};

/** Makes the confirmed export: a file for Markdown, a print page in a new tab for PDF. */
const confirmExport = (threadId: string, pick: ExportPick): void => {
  const href = hrefOf(threadId, pick, "confirm");
  if (pick === "print") {
    window.open(href, "_blank", "noopener");
    return;
  }
  Object.assign(document.createElement("a"), { href, download: "" }).click();
};

/** The line the dialog reads in each state. */
export const noticeText = (state: ExportNoticeState): string =>
  state.phase === "checking"
    ? EXPORT_CHECKING
    : state.phase === "failed"
      ? EXPORT_CHECK_FAILED
      : state.line;

export const ExportNoticeDialog = ({
  threadId,
  state,
  onClose,
}: Readonly<{
  threadId: string;
  state: ExportNoticeState | null;
  onClose: () => void;
}>) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const open = state !== null;

  useEffect(() => {
    const element = dialog.current;
    if (!element || !open) return;
    if (!element.open) element.showModal();
    return () => {
      if (element.open) element.close();
    };
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-label={state?.pick === "print" ? "Export as PDF" : "Download thread"}
      className="export-notice"
      onClose={onClose}
    >
      {state === null ? null : (
        <>
          <p className="export-notice-line" aria-live="polite">
            {noticeText(state)}
          </p>
          <div className="export-notice-actions">
            {state.phase === "ready" ? (
              <>
                <Button size="sm" onClick={() => dialog.current?.close()}>
                  Cancel
                </Button>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => {
                    confirmExport(threadId, state.pick);
                    dialog.current?.close();
                  }}
                >
                  Download
                </Button>
              </>
            ) : (
              <Button size="sm" onClick={() => dialog.current?.close()}>
                {state.phase === "checking" ? "Cancel" : "Close"}
              </Button>
            )}
          </div>
        </>
      )}
    </dialog>
  );
};

/** The notice's state and the action that opens it. */
export const useExportNotice = (threadId: string) => {
  const [state, setState] = useState<ExportNoticeState | null>(null);
  const pick = (choice: ExportPick) => {
    setState({ pick: choice, phase: "checking" });
    void checkExport(threadId, choice).then((next) =>
      // A notice closed while checking stays closed.
      setState((current) => (current === null ? null : next)),
    );
  };
  return { state, pick, close: () => setState(null) };
};
