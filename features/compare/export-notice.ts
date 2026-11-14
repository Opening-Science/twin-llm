import {
  describeFreeTextCheck,
  type FreeTextCheck,
} from "@/infrastructure/free-text-check";

/**
 * The notice before a thread export (SERVER-SPEC 3.7): which step a request
 * is, the one line the check answers, and the client's reading of it. Pure,
 * so the route and the shell's dialog share it.
 */

export type ExportStep = "check" | "confirmed" | "unconfirmed";

export const exportStep = (search: URLSearchParams): ExportStep =>
  search.get("check") === "1"
    ? "check"
    : search.get("confirm") === "1"
      ? "confirmed"
      : "unconfirmed";

export type ExportNotice = Readonly<{ status: "ready" | "refused"; line: string }>;

/** The check's answer, or null for anything that is not a notice. */
export const parseExportNotice = (body: unknown): ExportNotice | null => {
  if (typeof body !== "object" || body === null) return null;
  const { status, line } = body as Record<string, unknown>;
  return (status === "ready" || status === "refused") && typeof line === "string"
    ? { status, line }
    : null;
};

export const NOT_CHECKED_LINE =
  "This export could not be checked for stored values. Download anyway?";
export const NOTHING_FOUND_LINE =
  "No stored values were found in this export. Download it?";

/** The check's line: kinds and counts only, never a value. */
export const noticeLine = (check: FreeTextCheck | null): string =>
  check === null
    ? NOT_CHECKED_LINE
    : check.matches.length === 0
      ? NOTHING_FOUND_LINE
      : `This export contains: ${describeFreeTextCheck(check)}. Download anyway?`;

export const UNCONFIRMED_SENTENCE =
  "An export is made only after its notice is confirmed. Use Download or PDF on the thread.";
export const GENOME_IDS_EXPORT_SENTENCE =
  "This thread holds identifiers from your genome, so no file was made.";
export const NOT_RECORDED_SENTENCE =
  "The export could not be recorded, so no file was made. Try again.";
