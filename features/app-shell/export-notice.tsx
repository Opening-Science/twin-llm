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

export type ExportFormat = "markdown" | "print";

export const EXPORT_TITLE: Readonly<Record<ExportFormat, string>> = {
  markdown: "Download thread",
  print: "Export as PDF",
};

export const EXPORT_COPY = {
  checking: "Checking this export for stored values…",
  failed: "This export could not be checked, so nothing was made. Try again.",
} as const;

type Check =
  | Readonly<{ status: "checking" }>
  | Readonly<{ status: "ready" | "refused" | "failed"; line: string }>;

const checkHref = (threadId: string, format: ExportFormat): string =>
  threadExportHref(threadId, format === "print" ? "print" : undefined, "check");

const confirmHref = (threadId: string, format: ExportFormat): string =>
  threadExportHref(threadId, format === "print" ? "print" : undefined, "confirm");

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
    fetch(checkHref(threadId, format), {
      credentials: "same-origin",
      signal: abort.signal,
    })
      .then(async (response) => {
        const notice = response.ok
          ? parseExportNotice(await response.json().catch(() => null))
          : null;
        setCheck(notice ?? { status: "failed", line: EXPORT_COPY.failed });
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setCheck({ status: "failed", line: EXPORT_COPY.failed });
      });
    return () => abort.abort();
  }, [threadId, format]);

  const close = () => dialog.current?.close();

  const download = () => {
    const href = confirmHref(threadId, format);
    if (format === "print") {
      window.open(href, "_blank", "noopener");
    } else {
      const link = document.createElement("a");
      link.href = href;
      link.download = "";
      link.click();
    }
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
