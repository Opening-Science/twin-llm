"use client";

import { useEffect, useState } from "react";

/**
 * Recent Ark audit rows for this actor. Sequence, tool, time, and an 8-char
 * hash prefix — no args, result, or subject fields.
 */

export type GenomeAuditEvent = {
  readonly seq: string;
  readonly tool: string;
  readonly ts: string;
  readonly hash8: string;
};

type GenomeAuditProps = {
  readonly preview?: readonly GenomeAuditEvent[];
};

type AuditPayload = {
  readonly events: readonly GenomeAuditEvent[];
};

const isEvent = (value: unknown): value is GenomeAuditEvent => {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.seq === "string" &&
    typeof row.tool === "string" &&
    typeof row.ts === "string" &&
    typeof row.hash8 === "string"
  );
};

const isPayload = (value: unknown): value is AuditPayload => {
  if (typeof value !== "object" || value === null || !("events" in value)) return false;
  const { events } = value as { events: unknown };
  return Array.isArray(events) && events.every(isEvent);
};

const formatTs = (iso: string): string => {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toISOString().replace("T", " ").replace(".000Z", " UTC");
};

export const GenomeAudit = ({ preview }: GenomeAuditProps) => {
  const [events, setEvents] = useState<readonly GenomeAuditEvent[]>(preview ?? []);

  useEffect(() => {
    if (preview !== undefined) return;
    let cancelled = false;
    void fetch("/api/ark/audit")
      .then((response) => (response.ok ? response.json() : null))
      .then((value: unknown) => {
        if (cancelled || !isPayload(value)) return;
        setEvents(value.events);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [preview]);

  return (
    <article className="surface px-4 py-5">
      <h2 className="font-display text-xl tracking-tight">Audit trail</h2>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
        Last twenty Ark reads for this account. Hash prefix only — no dataset bytes.
      </p>
      {events.length === 0 ? (
        <p className="text-muted-foreground mt-4 text-sm">No recent Ark reads.</p>
      ) : (
        <ul className="mt-4 space-y-2">
          {events.map((event) => (
            <li
              key={`${event.seq}-${event.tool}`}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs"
            >
              <span className="font-mono">{event.seq}</span>
              <span>{event.tool}</span>
              <span className="text-muted-foreground">{formatTs(event.ts)}</span>
              <span className="font-mono">{event.hash8}</span>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
};
