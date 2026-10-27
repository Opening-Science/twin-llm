import type { TableSpec } from "@/infrastructure/chat-view";

import { cellText, columnDecimals, tableNote } from "./view-text";

/** `table`: the rows a query returned, in its order, under the columns the server chose. */
export const ViewTable = ({
  spec,
  label,
}: Readonly<{ spec: TableSpec; label: string }>) => {
  const decimals = columnDecimals(spec);
  const note = tableNote(spec);
  if (spec.rows.length === 0) {
    return <p className="text-muted-foreground text-sm">No readings in this window.</p>;
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="max-h-96 overflow-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="bg-card sticky top-0">
            <tr className="border-border border-b">
              {spec.columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`text-muted-foreground px-2 py-1 text-xs font-medium ${column.format === "number" ? "text-right" : "text-left"}`}
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
                    className={`px-2 py-1 ${column.format === "number" ? "text-right font-mono tabular-nums" : ""}`}
                  >
                    {cellText(row[column.key], column.format, decimals[column.key] ?? 0)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {note !== null && <p className="text-muted-foreground text-xs">{note}</p>}
    </div>
  );
};
