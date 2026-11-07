import Link from "next/link";

import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import {
  type CheckState,
  checkHref,
  type LabCheck,
  STATUS_LABEL,
  STATUS_TONE,
  unknownReason,
} from "./lab-check";

/**
 * The Verifiability checks as one compact list (#459): a row per check with
 * its state in words and its title. An Unknown row also says why in one
 * line under the title (#483). Each row opens the check's own page with the
 * evidence and the command. The look lives in `globals.css` under "The
 * Lab's checks".
 */
export type CheckRow = Pick<LabCheck, "id" | "title"> & CheckState;

export const CheckList = ({ checks }: Readonly<{ checks: readonly CheckRow[] }>) => (
  <ul aria-label="Checks" className="check-list">
    {checks.map((check) => {
      const reason = unknownReason(check);
      return (
        <li key={check.id}>
          <Link href={checkHref(check.id)} className="check-row">
            <StatusBadge tone={STATUS_TONE[check.status]} className="w-16">
              {STATUS_LABEL[check.status]}
            </StatusBadge>
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium">{check.title}</span>
              {reason === null ? null : <span className="check-reason">{reason}</span>}
            </span>
          </Link>
        </li>
      );
    })}
  </ul>
);
