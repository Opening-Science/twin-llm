/**
 * The answer to a thread export's check step (SERVER-SPEC 3.7), read the same
 * way by the export route's tests and the thread bar's notice dialog.
 */

export type ExportNotice = Readonly<{ status: "ready" | "refused"; line: string }>;

/** The check's answer, or null for anything that is not a notice. */
export const parseExportNotice = (body: unknown): ExportNotice | null => {
  if (typeof body !== "object" || body === null) return null;
  const { status, line } = body as Record<string, unknown>;
  return (status === "ready" || status === "refused") && typeof line === "string"
    ? { status, line }
    : null;
};
