import { type EvidenceTable } from "./lab-check";

/**
 * A Lab table: the first cell of each row is its header, the rest are
 * values. Scrolls sideways inside its frame on a phone, so the page never
 * does. Server-rendered.
 */
export const LabTable = ({ table }: Readonly<{ table: EvidenceTable }>) => (
  <div className="lab-table-wrap">
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
                <td key={index}>{cell}</td>
              ),
            )}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);
