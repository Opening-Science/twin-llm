"use client";

import { useEffect, useState } from "react";

import {
  EMPTY_VALUE,
  formatNumber,
  formatRelative,
} from "@/infrastructure/format-measure";
import { Button } from "@/infrastructure/ui-kit/button";
import { StatusBadge } from "@/infrastructure/ui-kit/status-badge";

import {
  type GenomeReportView,
  isReportPayload,
  isRunPayload,
  runFailure,
} from "./genome-report-view";
import { GENOME_REPORT_COPY as COPY } from "./twin-page-copy";

/**
 * The rsid-genotypes run on the genome dashboard. Run asks the server to
 * start the Ark app; the CLI then blocks until the owner approves on their
 * phone, so the whole wait is the "Approve on your phone" state. The released
 * report is stored on this machine and shown as a table; a reload shows the
 * stored one without asking the Ark again.
 */

type Phase =
  | Readonly<{ kind: "loading" }>
  | Readonly<{ kind: "hidden" }>
  | Readonly<{ kind: "ready"; report: GenomeReportView | null; error: string | null }>
  | Readonly<{ kind: "running"; report: GenomeReportView | null }>;

type GenomeReportProps = Readonly<{
  /** Tests and screenshots only: a fixed phase instead of the routes. */
  preview?: Phase;
}>;

const ReportTable = ({ report }: Readonly<{ report: GenomeReportView }>) => (
  <>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[34rem] text-left text-sm">
        <caption className="sr-only">{COPY.tableCaption}</caption>
        <thead className="text-muted-foreground text-xs">
          <tr>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              rsID
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Gene
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Allele
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Position
            </th>
            <th scope="col" className="py-1.5 pr-3 font-medium">
              Ref
            </th>
            <th scope="col" className="py-1.5 font-medium">
              Genotype
            </th>
          </tr>
        </thead>
        <tbody className="divide-border divide-y">
          {report.rows.map((row) => (
            <tr key={row.rsid}>
              <td className="py-1.5 pr-3 font-mono text-xs">{row.rsid}</td>
              <td className="py-1.5 pr-3">{row.gene}</td>
              <td className="py-1.5 pr-3">{row.allele}</td>
              <td className="py-1.5 pr-3 font-mono text-xs">
                {row.chromosome ?? EMPTY_VALUE}:
                {row.position === null ? EMPTY_VALUE : formatNumber(row.position, 0)}
              </td>
              <td className="py-1.5 pr-3 font-mono text-xs">
                {row.reference ?? EMPTY_VALUE}
              </td>
              <td className="py-1.5 font-mono text-xs">
                {row.genotype ?? (
                  <span className="text-muted-foreground font-sans">{COPY.noCall}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
    <p className="text-muted-foreground mt-3 text-xs leading-relaxed">
      {report.buildNote}. Released {formatRelative(report.releasedAt)}. {report.footer}
    </p>
  </>
);

const Waiting = () => (
  <div role="status" className="border-border mt-4 rounded-lg border px-4 py-4">
    <StatusBadge tone="warn">{COPY.approveTitle}</StatusBadge>
    <p className="mt-2 text-sm leading-relaxed">{COPY.approveBody}</p>
    <p className="text-muted-foreground mt-1 text-xs leading-relaxed">
      {COPY.approveNote}
    </p>
  </div>
);

export const GenomeReport = ({ preview }: GenomeReportProps) => {
  const [phase, setPhase] = useState<Phase>(preview ?? { kind: "loading" });

  useEffect(() => {
    if (preview !== undefined) return;
    let cancelled = false;
    void fetch("/api/genome/report")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (cancelled) return;
        if (!isReportPayload(value) || !value.enabled) {
          setPhase({ kind: "hidden" });
          return;
        }
        setPhase({ kind: "ready", report: value.report, error: null });
      })
      .catch(() => {
        if (!cancelled) setPhase({ kind: "hidden" });
      });
    return () => {
      cancelled = true;
    };
  }, [preview]);

  if (phase.kind === "hidden" || phase.kind === "loading") return null;

  const report = phase.report;
  const run = () => {
    setPhase({ kind: "running", report });
    void fetch("/api/genome/run", { method: "POST" })
      .then((response) => response.json())
      .then((value: unknown) => {
        const payload = isRunPayload(value) ? value : runFailure("error");
        setPhase(
          payload.ok
            ? { kind: "ready", report: payload.report, error: null }
            : { kind: "ready", report, error: payload.message },
        );
      })
      .catch(() =>
        setPhase({ kind: "ready", report, error: runFailure("error").message }),
      );
  };

  return (
    <article className="surface px-4 py-5 lg:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-display text-xl tracking-tight">{COPY.title}</h2>
          <p className="text-muted-foreground mt-1 max-w-xl text-sm leading-relaxed">
            {COPY.note}
          </p>
        </div>
        <Button
          variant={report === null ? "primary" : "secondary"}
          disabled={phase.kind === "running"}
          onClick={run}
        >
          {report === null ? COPY.run : COPY.runAgain}
        </Button>
      </div>
      {phase.kind === "running" ? <Waiting /> : null}
      {phase.kind === "ready" && phase.error !== null ? (
        <p role="alert" className="mt-4 text-sm leading-relaxed">
          {phase.error}
        </p>
      ) : null}
      {report === null ? (
        phase.kind === "ready" ? (
          <p className="text-muted-foreground mt-4 text-sm">{COPY.empty}</p>
        ) : null
      ) : (
        <ReportTable report={report} />
      )}
    </article>
  );
};
