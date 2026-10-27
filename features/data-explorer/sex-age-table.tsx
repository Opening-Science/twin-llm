import { formatNumber } from "@/infrastructure/format-measure";

import { SEX_LABELS, type SexAgeSplit } from "./sex-age-split";

const NUMBER_CELL = "px-2 py-1.5 text-right font-mono text-xs";

/** Subjects per age band (rows) and sex (columns), with totals both ways. */
export const SexAgeTable = ({ split }: { readonly split: SexAgeSplit }) => (
  <div className="relative overflow-x-auto">
    <table className="w-full min-w-md border-collapse text-sm">
      <caption className="sr-only">
        Subjects in the cohort by age band and sex, with totals
      </caption>
      <thead>
        <tr className="border-border border-b">
          <th scope="col" className="text-eyebrow px-2 py-2 text-left">
            Age band
          </th>
          {split.columns.map((column) => (
            <th key={column} scope="col" className="text-eyebrow px-2 py-2 text-right">
              {SEX_LABELS[column]}
            </th>
          ))}
          <th scope="col" className="text-eyebrow px-2 py-2 text-right">
            All
          </th>
        </tr>
      </thead>
      <tbody>
        {split.bands.map((band) => (
          <tr key={band.id} className="border-border border-b">
            <th scope="row" className="px-2 py-1.5 text-left font-normal">
              {band.label}
            </th>
            {split.columns.map((column) => (
              <td key={column} className={NUMBER_CELL}>
                {formatNumber(band.counts[column], 0)}
              </td>
            ))}
            <td className={NUMBER_CELL}>{formatNumber(band.total, 0)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row" className="px-2 py-1.5 text-left font-medium">
            All ages
          </th>
          {split.columns.map((column) => (
            <td key={column} className={`${NUMBER_CELL} font-medium`}>
              {formatNumber(split.totals[column], 0)}
            </td>
          ))}
          <td className={`${NUMBER_CELL} font-medium`}>{formatNumber(split.total, 0)}</td>
        </tr>
      </tfoot>
    </table>
  </div>
);
