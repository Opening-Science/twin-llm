import Link from "next/link";

import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import { checkHref, type LabCheck, STATUS_LABEL, STATUS_TONE } from "./lab-check";

/**
 * The Verifiability checks as one compact list (#459): a row per check with
 * its state in words and its title. Each row opens the check's own page with
 * the evidence and the command; nothing else is on the row, so nine checks
 * fit one screen. The look lives in `globals.css` under "The Lab's checks".
 */
export type CheckRow = Pick<LabCheck, "id" | "title" | "status">;

export const CheckList = ({ checks }: Readonly<{ checks: readonly CheckRow[] }>) => (
  <ul aria-label="Checks" className="check-list">
    {checks.map((check) => (
      <li key={check.id}>
        <Link href={checkHref(check.id)} className="check-row">
          <StatusBadge tone={STATUS_TONE[check.status]} className="w-16">
            {STATUS_LABEL[check.status]}
          </StatusBadge>
          <span className="text-sm font-medium">{check.title}</span>
        </Link>
      </li>
    ))}
  </ul>
);
