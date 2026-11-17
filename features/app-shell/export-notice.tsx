"use client";

import { useEffect, useRef, useState } from "react";

import { parseExportNotice } from "@/infrastructure/export-notice";
import { threadExportHref } from "@/infrastructure/shell-links";
import { Button } from "@/infrastructure/ui-kit/button";

/**
 * The notice before a thread export (#531). Opening it asks the server what
 * the export holds; nothing is made until the person presses Download, which
 * asks for the file with the confirm step the server records. Mounted only
 * while open; closing it while the check runs drops the answer.
 */

export type ExportFormat = "markdown" | "pdf";

export const EXPORT_TITLE: Readonly<Record<ExportFormat, string>> = {
  markdown: "Download thread",
  pdf: "Export as PDF",
};

export const EXPORT_COPY = {
  checking: "Checking this export for stored values…",
  failed: "This export could not be checked, so nothing was made. Try again.",
} as const;

export type CheckAnswer = Readonly<{
  status: "ready" | "refused" | "failed";
  line: string;
}>;

type Check = Readonly<{ status: "checking" }> | CheckAnswer;

const exportHref = (
  threadId: string,
  format: ExportFormat,
  step: "check" | "confirm",
): string => threadExportHref(threadId, format === "pdf" ? "pdf" : undefined, step);

/**
 * Asks the server what the export holds. Only a well-formed notice can be
 * ready or refused; a failed request or any other answer is a failure, which
 * offers no Download.
 */
export const checkExport = async (
  threadId: string,
  format: ExportFormat,
  ask: (href: string, init: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<CheckAnswer> => {
  const failed: CheckAnswer = { status: "failed", line: EXPORT_COPY.failed };
  const response = await ask(exportHref(threadId, format, "check"), {
    credentials: "same-origin",
    signal,
  });
  if (!response.ok) return failed;
  return parseExportNotice(await response.json().catch(() => null)) ?? failed;
};

export const ExportNotice = ({
  threadId,
  format,
  onClose,
}: Readonly<{ threadId: string; format: ExportFormat; onClose: () => void }>) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [check, setCheck] = useState<Check>({ status: "checking" });

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    const abort = new AbortController();
    checkExport(threadId, format, (href, init) => fetch(href, init), abort.signal)
      .then(setCheck)
      .catch(() => {
        if (!abort.signal.aborted)
          setCheck({ status: "failed", line: EXPORT_COPY.failed });
      });
    return () => abort.abort();
  }, [threadId, format]);

  const close = () => dialog.current?.close();

  const download = () => {
    // The route answers with the file as an attachment, Markdown or PDF.
    const link = document.createElement("a");
    link.href = exportHref(threadId, format, "confirm");
    link.download = "";
    link.click();
    close();
  };

  return (
    <dialog
      ref={dialog}
      aria-label={EXPORT_TITLE[format]}
      className="export-notice"
      onClose={onClose}
    >
      <p role="status" className="export-notice-line">
        {check.status === "checking" ? EXPORT_COPY.checking : check.line}
      </p>
      <div className="export-notice-actions">
        <Button variant="secondary" onClick={close}>
          {check.status === "checking" || check.status === "ready" ? "Cancel" : "Close"}
        </Button>
        {check.status === "ready" && (
          <Button variant="primary" onClick={download}>
            Download
          </Button>
        )}
      </div>
    </dialog>
  );
};
