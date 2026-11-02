import type { GbdCsvError } from "@/packages/gbd-local/results-csv";

/**
 * The lines `POST /api/gbd/imports` answers with once the upload is saved
 * (#426): newline-delimited JSON, a `progress` line per chunk read and one
 * last line with the outcome. Pure, shared by the route and the page.
 */

export type GbdImportEvent =
  | Readonly<{ type: "progress"; bytes: number; rows: number }>
  | Readonly<{
      type: "imported";
      sha256: string;
      rowCount: number;
      newRows: number;
    }>
  | Readonly<{ type: "already-imported"; sha256: string }>
  | Readonly<{ type: "refused"; error: GbdCsvError }>
  | Readonly<{ type: "failed"; message: string }>;

/** The request headers that carry the file's name and the citation, URI-encoded. */
export const GBD_FILE_NAME_HEADER = "x-gbd-file-name";
export const GBD_CITATION_HEADER = "x-gbd-citation";

export const eventLine = (event: GbdImportEvent): string => `${JSON.stringify(event)}\n`;

const TYPES: ReadonlySet<string> = new Set([
  "progress",
  "imported",
  "already-imported",
  "refused",
  "failed",
]);

const isEvent = (value: unknown): value is GbdImportEvent =>
  typeof value === "object" &&
  value !== null &&
  TYPES.has(String(Reflect.get(value, "type")));

/**
 * The complete events in `text` and the unfinished last line, to keep for
 * the next read. A line that is not an event is left out.
 */
export const readEvents = (
  text: string,
): Readonly<{ events: readonly GbdImportEvent[]; rest: string }> => {
  const lines = text.split("\n");
  const rest = lines.pop() ?? "";
  const events = lines.flatMap((line) => {
    if (line.trim() === "") return [];
    try {
      const value: unknown = JSON.parse(line);
      return isEvent(value) ? [value] : [];
    } catch {
      return [];
    }
  });
  return { events, rest };
};
