import { cn } from "@/infrastructure/ui";

import { type EvidenceTable } from "./lab-check";

/**
 * A Lab table: the first cell of each row is its header, the rest are
 * values. By default it scrolls sideways inside its frame on a phone, so the
 * page never does. `stack` (a check's page, #483) wraps long cells instead
 * and, on a phone, shows each row as label and value pairs, so nothing is
 * cut off. Server-rendered.
 */
export const LabTable = ({
  table,
  layout = "scroll",
}: Readonly<{ table: EvidenceTable; layout?: "scroll" | "stack" }>) => (
  <div className={cn("lab-table-wrap", layout === "stack" && "lab-table-stack")}>
    <table className="lab-table">
      <caption className="sr-only">{table.caption}</caption>
      <thead>
        <tr>
          {table.columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {table.rows.map((row, rowIndex) => (
          <tr key={`${rowIndex}:${row[0] ?? ""}`}>
            {row.map((cell, index) =>
              index === 0 ? (
                <th key={index} scope="row">
                  {cell}
                </th>
              ) : (
                <td key={index} data-label={table.columns[index]}>
                  {cell}
                </td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
