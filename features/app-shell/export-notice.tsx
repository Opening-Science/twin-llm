"use client";

import { useEffect, useRef, useState } from "react";

import { parseExportNotice } from "@/infrastructure/export-notice";
import { threadExportHref } from "@/infrastructure/shell-links";
import { Button } from "@/infrastructure/ui-kit/button";

/**
 * The notice before a thread export (#531). Opening it asks the server what
 * the export holds; nothing is made until the person presses Download, which
 * asks for the file with the confirm step the server records. When no file
 * is made, the notice stays open with the reason. Mounted only while open;
 * closing it while a request runs drops the answer.
 */

export type ExportFormat = "markdown" | "pdf";

export const EXPORT_TITLE: Readonly<Record<ExportFormat, string>> = {
  markdown: "Download thread",
  pdf: "Export as PDF",
};

export const EXPORT_COPY = {
  checking: "Checking this export for stored values…",
  failed: "This export could not be checked, so nothing was made. Try again.",
  making: "Making the file…",
  notMade: "The file could not be made. Try again.",
} as const;

export type CheckAnswer = Readonly<{
  status: "ready" | "refused" | "failed";
  line: string;
}>;

type Check =
  Readonly<{ status: "checking" }> | Readonly<{ status: "making" }> | CheckAnswer;

export type ConfirmAnswer =
  | Readonly<{ status: "made"; file: Blob; name: string }>
  | Readonly<{ status: "failed"; line: string }>;

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

/** The sentence a refusal carries: the route's plain text or the vault gate's message. */
const refusalLine = async (response: Response): Promise<string | null> => {
  const type = response.headers.get("content-type") ?? "";
  if (type.startsWith("text/plain")) return (await response.text()).trim() || null;
  if (!type.startsWith("application/json")) return null;
  const body: unknown = await response.json();
  return typeof body === "object" &&
    body !== null &&
    "message" in body &&
    typeof body.message === "string"
    ? body.message
    : null;
};

const fileName = (response: Response, format: ExportFormat): string =>
  /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ??
  (format === "pdf" ? "thread.pdf" : "thread.md");

/**
 * Asks for the confirmed file. A refusal or failure keeps the route's own
 * sentence, so the notice can say why no file was made; anything else (an
 * error page, a lost connection) gets one plain line, never raw error text.
 */
export const confirmExport = async (
  threadId: string,
  format: ExportFormat,
  ask: (href: string, init: RequestInit) => Promise<Response>,
  signal?: AbortSignal,
): Promise<ConfirmAnswer> => {
  const failed = (line: string | null) =>
    ({ status: "failed", line: line ?? EXPORT_COPY.notMade }) as const;
  try {
    const response = await ask(exportHref(threadId, format, "confirm"), {
      credentials: "same-origin",
      signal,
    });
    if (!response.ok) return failed(await refusalLine(response).catch(() => null));
    return {
      status: "made",
      file: await response.blob(),
      name: fileName(response, format),
    };
  } catch {
    return failed(null);
  }
};

/** Hands a made file to the browser's downloads. */
const save = (file: Blob, name: string) => {
  const href = URL.createObjectURL(file);
  const link = document.createElement("a");
  link.href = href;
  link.download = name;
  link.click();
  // Released after the click has handed the file over, not during it.
  setTimeout(() => URL.revokeObjectURL(href), 0);
};

export const ExportNotice = ({
  threadId,
  format,
  onClose,
}: Readonly<{ threadId: string; format: ExportFormat; onClose: () => void }>) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const aborts = useRef<AbortController | null>(null);
  const [check, setCheck] = useState<Check>({ status: "checking" });

  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) element.showModal();
    const abort = new AbortController();
    aborts.current = abort;
    checkExport(threadId, format, (href, init) => fetch(href, init), abort.signal)
      .then(setCheck)
      .catch(() => {
        if (!abort.signal.aborted)
          setCheck({ status: "failed", line: EXPORT_COPY.failed });
      });
    return () => abort.abort();
  }, [threadId, format]);

  const close = () => dialog.current?.close();

  // The file is fetched, not followed as a link, so a refusal or failure
  // stays in the notice instead of becoming a failed or wrong download.
  const download = async () => {
    const signal = aborts.current?.signal;
    setCheck({ status: "making" });
    const answer = await confirmExport(
      threadId,
      format,
      (href, init) => fetch(href, init),
      signal,
    );
    if (signal?.aborted === true) return;
    if (answer.status === "failed") {
      setCheck(answer);
      return;
    }
    save(answer.file, answer.name);
    close();
  };

  const line =
    check.status === "checking"
      ? EXPORT_COPY.checking
      : check.status === "making"
        ? EXPORT_COPY.making
        : check.line;

  return (
    <dialog
      ref={dialog}
      aria-label={EXPORT_TITLE[format]}
      className="export-notice"
      onClose={onClose}
    >
      <p role="status" className="export-notice-line">
        {line}
      </p>
      <div className="export-notice-actions">
        <Button variant="secondary" onClick={close}>
          {check.status === "refused" || check.status === "failed" ? "Close" : "Cancel"}
        </Button>
        {check.status === "ready" && (
          <Button variant="primary" onClick={() => void download()}>
            Download
          </Button>
        )}
      </div>
    </dialog>
  );
};
