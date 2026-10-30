import { Card } from "@/infrastructure/ui-kit/card";
import { StatusBadge, type StatusTone } from "@/infrastructure/ui-kit/status-badge";

import {
  type CheckStatus,
  type EvidenceTable,
  type LabCheck,
  splitCode,
  STATUS_LABEL,
} from "./lab-check";

/**
 * One check: its state in words, what was found, the evidence, and the
 * command that repeats it by hand. Server-rendered; nothing here runs in the
 * browser.
 */

const TONE: Readonly<Record<CheckStatus, StatusTone>> = {
  ok: "ok",
  "not-ok": "warn",
  unknown: "neutral",
};

const Prose = ({ text }: Readonly<{ text: string }>) => (
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

const Table = ({ table }: Readonly<{ table: EvidenceTable }>) => (
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
        {table.rows.map((row) => (
          <tr key={row.join("\0")}>
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

export const CheckCard = ({ check }: Readonly<{ check: LabCheck }>) => {
  const headingId = `lab-${check.id}`;
  return (
    <Card as="article" padding="md" className="flex min-w-0 flex-col gap-3">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <h3 id={headingId} className="text-base font-medium">
          {check.title}
        </h3>
        <StatusBadge tone={TONE[check.status]}>{STATUS_LABEL[check.status]}</StatusBadge>
      </header>
      <p className="text-muted-foreground text-sm leading-relaxed">
        <Prose text={check.summary} />
      </p>
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
        <Table table={check.table} />
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
};
