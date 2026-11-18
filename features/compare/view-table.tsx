import type { TableSpec } from "@/infrastructure/chat-view";
import { cn } from "@/infrastructure/ui";

import {
  cellText,
  columnDecimals,
  NO_READINGS_IN_WINDOW,
  truncationLine,
} from "./view-text";

/**
 * Rows in query order under the columns the server chose (SPEC 5.5): numbers
 * right-aligned in monospace at the decimals they were written with, dates
 * as days, missing as a dash. The header stays put while the box scrolls.
 */
export const TableView = ({
  title,
  spec,
}: Readonly<{ title: string; spec: TableSpec }>) => {
  if (spec.rows.length === 0) {
    return <p className="text-muted-foreground text-sm">{NO_READINGS_IN_WINDOW}</p>;
  }
  const decimals = new Map(
    spec.columns.map((column) => [column.key, columnDecimals(spec.rows, column.key)]),
  );
  const cut = truncationLine(spec.rows.length, spec.total);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="border-border max-h-96 overflow-auto rounded-md border">
        <table className="w-full border-collapse text-xs">
          <caption className="sr-only">{title}</caption>
          <thead className="bg-card sticky top-0">
            <tr>
              {spec.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "border-border text-muted-foreground border-b px-2 py-1.5 font-medium",
                    column.format === "number" ? "text-right" : "text-left",
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {spec.rows.map((row, index) => (
              <tr key={index} className="border-border border-b last:border-b-0">
                {spec.columns.map((column) => (
                  <td
                    key={column.key}
                    className={cn(
                      "px-2 py-1",
                      column.format === "number" && "text-right font-mono tabular-nums",
                    )}
                  >
                    {cellText(
                      row[column.key],
                      column.format,
                      decimals.get(column.key) ?? 0,
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cut === null ? null : <p className="text-muted-foreground text-xs">{cut}</p>}
    </div>
  );
};
