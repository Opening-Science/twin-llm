import {
  directionLabel,
  type LedgerEntry,
  ledgerTotals,
  type RecipientTotal,
  type ValueRef,
} from "@/infrastructure/disclosure-ledger";
import {
  describeFreeTextCheck,
  parseFreeTextMatches,
} from "@/infrastructure/free-text-check";
import {
  formatBytes,
  formatNumber,
  formatTimestamp,
  formatUtcCell,
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
  direction: "Sent" | "Received" | "Blocked";
  events: string;
  /** UTC, without the zone: the column heading names it ("First (UTC)"). */
  since: string;
  /** UTC, without the zone, like `since`. */
  last: string;
  values: string;
  size: string;
  categories: string;
  /** How many checked events held stored values in their free text (#346). */
  freeText: string;
  /** True when any did. */
  freeTextFound: boolean;
}>;

export type EntryView = Readonly<{
  key: string;
  when: string;
  recipient: string;
  direction: "Sent" | "Received" | "Blocked";
  what: string;
  categories: string;
  values: string;
  size: string;
  synthetic: boolean;
  threadHref: string | null;
  refs: readonly string[];
  /** What the free text check found (#346), or that it did not run. */
  freeText: string;
  /** True when the check found stored values in the free text. */
  freeTextFound: boolean;
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

const sizeOf = (bytes: number | null): string =>
  bytes === null ? "not measured" : formatBytes(bytes);

/** "2 of 9 checked", "none of 9 checked", or "not checked" when no event was. */
const freeTextTotal = (total: RecipientTotal): string => {
  if (total.freeTextChecked === 0) return "not checked";
  const checked = formatNumber(total.freeTextChecked, 0);
  return total.freeTextFound === 0
    ? `none of ${checked} checked`
    : `${formatNumber(total.freeTextFound, 0)} of ${checked} checked`;
};

const recipientView = (total: RecipientTotal): RecipientView => ({
  key: `${total.direction}|${total.recipient}`,
  recipient: total.recipient,
  direction: directionLabel(total.direction),
  events:
    total.syntheticEvents === 0
      ? formatNumber(total.events, 0)
      : `${formatNumber(total.events, 0)}, ${formatNumber(total.syntheticEvents, 0)} synthetic`,
  since: formatUtcCell(total.first),
  last: formatUtcCell(total.last),
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
  freeText: freeTextTotal(total),
  freeTextFound: total.freeTextFound > 0,
});

/** "Model request: chat answer"; the purpose alone when it repeats the kind. */
const whatOf = (kind: string, purpose: string): string => {
  const label = KIND_LABELS[kind] ?? kind;
  return label.toLowerCase() === purpose.toLowerCase() ? label : `${label}: ${purpose}`;
};

/** The free text check of one row, in words: kinds and counts, never a value. */
export const freeTextOf = (
  entry: Pick<LedgerEntry, "freeTextChecked" | "freeTextMatches">,
): Readonly<{ text: string; found: boolean }> => {
  const check = entry.freeTextChecked
    ? parseFreeTextMatches(entry.freeTextMatches)
    : null;
  if (check === null) return { text: "not checked", found: false };
  return { text: describeFreeTextCheck(check), found: check.matches.length > 0 };
};

const entryView = (entry: LedgerEntry & Readonly<{ refs: readonly ValueRef[] }>) => ({
  key: String(entry.seq),
  when: formatTimestamp(entry.ts),
  recipient:
    entry.target === null ? entry.recipient : `${entry.recipient} · ${entry.target}`,
  direction: directionLabel(entry.direction),
  what: whatOf(entry.kind, entry.purpose),
  categories: entry.categories.join(", "),
  values: formatNumber(entry.refCount, 0),
  size: sizeOf(entry.payloadBytes),
  synthetic: entry.synthetic,
  threadHref: entry.threadId === null ? null : `/t/${encodeURIComponent(entry.threadId)}`,
  refs: entry.refs.map((ref) => `${SOURCE_LABELS[ref.source]}: ${ref.key}`),
  freeText: freeTextOf(entry).text,
  freeTextFound: freeTextOf(entry).found,
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
