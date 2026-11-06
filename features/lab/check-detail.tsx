import { Card } from "@/infrastructure/ui-kit/card";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import { type LabCheck, splitCode, STATUS_LABEL, STATUS_TONE } from "./lab-check";
import { LabTable } from "./lab-table";

/**
 * One check on its own page (#459): its state in words, the evidence, and
 * the command that repeats it by hand. The page frame carries the title and
 * what was found. Server-rendered; nothing here runs in the browser.
 */

/** Copy with `commands` in backticks drawn as code. */
export const Prose = ({ text }: Readonly<{ text: string }>) => (
  <>
    {splitCode(text).map((part, index) =>
      part.code ? (
        <code key={index} className="setup-code">
          {part.text}
        </code>
      ) : (
        <span key={index}>{part.text}</span>
      ),
    )}
  </>
);

export const CheckDetail = ({ check }: Readonly<{ check: LabCheck }>) => (
  <Card as="section" padding="md" className="flex min-w-0 flex-col gap-3">
    <StatusBadge tone={STATUS_TONE[check.status]} className="text-sm">
      {STATUS_LABEL[check.status]}
    </StatusBadge>
    {check.evidence.length > 0 ? (
      <dl className="lab-evidence">
        {check.evidence.map((item) => (
          <div key={item.label} className="contents">
            <dt>{item.label}</dt>
            <dd className={item.mono ? "font-mono" : undefined}>{item.value}</dd>
          </div>
        ))}
      </dl>
    ) : null}
    {check.table !== undefined && check.table.rows.length > 0 ? (
      <LabTable table={check.table} />
    ) : null}
    <div className="flex flex-col gap-1.5">
      <p className="text-eyebrow">Check it yourself</p>
      <pre className="command-block" aria-label={`Command for ${check.title}`}>
        <code>{check.howTo}</code>
      </pre>
    </div>
    {check.links !== undefined && check.links.length > 0 ? (
      <ul className="flex flex-wrap gap-x-4 gap-y-1">
        {check.links.map((link) => (
          <li key={link.href}>
            <a
              href={link.href}
              className="setup-link"
              {...(link.href.startsWith("http")
                ? { target: "_blank", rel: "noreferrer" }
                : {})}
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    ) : null}
  </Card>
);
