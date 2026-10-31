import {
  type LedgerEntry,
  ledgerTotals,
  type RecipientTotal,
  type ValueRef,
} from "@/infrastructure/disclosure-ledger";
import {
  formatBytes,
  formatNumber,
  formatTimestamp,
} from "@/infrastructure/format-measure";

/**
 * What Customize · Privacy shows of the disclosure ledger (#140): one line
 * per recipient with running totals, and the latest events, each with the
 * stored values it carried as references. Pure; the page reads the rows
 * (only after the unlock) and the section renders this.
 */

export type RecipientView = Readonly<{
  key: string;
  recipient: string;
  direction: "Sent" | "Received";
  events: string;
  since: string;
  last: string;
  values: string;
  size: string;
  categories: string;
}>;

export type EntryView = Readonly<{
  key: string;
  when: string;
  recipient: string;
  direction: "Sent" | "Received";
  what: string;
  categories: string;
  values: string;
  size: string;
  synthetic: boolean;
  threadHref: string | null;
  refs: readonly string[];
}>;

export type LedgerView = Readonly<{
  recipients: readonly RecipientView[];
  entries: readonly EntryView[];
  /** Set when there are more events than `entries` shows. */
  shownOf: string | null;
}>;

const KIND_LABELS: Readonly<Record<string, string>> = {
  "hosted-model": "Model request",
  "vendor-sync": "Wearable sync",
  "vendor-auth": "Wearable connect",
  "export-file": "Thread export",
  "ark-release": "Ark release",
  "remote-tool": "Remote tool",
  embedding: "Search embedding",
  telemetry: "Analytics event",
  "public-lookup": "Public lookup",
};

const SOURCE_LABELS: Readonly<Record<ValueRef["source"], string>> = {
  wearable: "Wearable",
  scan: "Body scan",
  import: "Imported",
  genome: "Genome site",
  note: "Twin note",
  chat: "Chat",
};

const directionOf = (value: string): "Sent" | "Received" =>
  value === "received" ? "Received" : "Sent";

const sizeOf = (bytes: number | null): string =>
  bytes === null ? "not measured" : formatBytes(bytes);

const recipientView = (total: RecipientTotal): RecipientView => ({
  key: `${total.direction}|${total.recipient}`,
  recipient: total.recipient,
  direction: total.direction === "received" ? "Received" : "Sent",
  events:
    total.syntheticEvents === 0
      ? formatNumber(total.events, 0)
      : `${formatNumber(total.events, 0)}, ${formatNumber(total.syntheticEvents, 0)} synthetic`,
  since: formatTimestamp(total.first),
  last: formatTimestamp(total.last),
  values: formatNumber(total.refs, 0),
  size:
    total.unmeasured === total.events
      ? "not measured"
      : total.unmeasured === 0
        ? formatBytes(total.bytes)
        : `${formatBytes(total.bytes)}, ${formatNumber(total.unmeasured, 0)} not measured`,
  categories: total.categories
    .map((item) => `${item.category} (${formatNumber(item.events, 0)})`)
    .join(", "),
});

/** "Model request: chat answer"; the purpose alone when it repeats the kind. */
const whatOf = (kind: string, purpose: string): string => {
  const label = KIND_LABELS[kind] ?? kind;
  return label.toLowerCase() === purpose.toLowerCase() ? label : `${label}: ${purpose}`;
};

const entryView = (entry: LedgerEntry & Readonly<{ refs: readonly ValueRef[] }>) => ({
  key: String(entry.seq),
  when: formatTimestamp(entry.ts),
  recipient:
    entry.target === null ? entry.recipient : `${entry.recipient} · ${entry.target}`,
  direction: directionOf(entry.direction),
  what: whatOf(entry.kind, entry.purpose),
  categories: entry.categories.join(", "),
  values: formatNumber(entry.refCount, 0),
  size: sizeOf(entry.payloadBytes),
  synthetic: entry.synthetic,
  threadHref: entry.threadId === null ? null : `/t/${encodeURIComponent(entry.threadId)}`,
  refs: entry.refs.map((ref) => `${SOURCE_LABELS[ref.source]}: ${ref.key}`),
});

/**
 * `totalsOf` are every row's fields (no references); `latest` the newest
 * rows with their references, newest first.
 */
export const ledgerView = (
  totalsOf: readonly LedgerEntry[],
  latest: readonly (LedgerEntry & Readonly<{ refs: readonly ValueRef[] }>)[],
): LedgerView => ({
  recipients: ledgerTotals(totalsOf).map(recipientView),
  entries: latest.map(entryView),
  shownOf:
    totalsOf.length > latest.length
      ? `The latest ${formatNumber(latest.length, 0)} of ${formatNumber(totalsOf.length, 0)} events.`
      : null,
});
