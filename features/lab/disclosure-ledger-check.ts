import { directionLabel, type RecipientTotal } from "@/infrastructure/disclosure-ledger";
import {
  formatBytes,
  formatNumber,
  formatTimestamp,
} from "@/infrastructure/format-measure";
import type { VerifyChainResult } from "@/packages/audit/chain";

import { type LabCheck, plural, shortHash } from "./lab-check";

/**
 * What left this machine (#140): the disclosure ledger's chain, and running
 * totals per recipient. The chain check reads no sealed column, so it runs
 * while the vault is locked; the recipients are shown only to a viewer
 * whose data is unlocked (or on a synthetic install). Channels that cannot
 * be itemised (Clerk, Arcjet, PostHog in the browser) are named when
 * configured, so the card never claims more than the ledger holds.
 */

const ID = "disclosure-ledger";
const TITLE = "What left this machine";

export const DISCLOSURE_LEDGER_HOW_TO = [
  "bun --env-file=.env.local packages/audit/verify-cli.ts --check --chain disclosures",
  "",
  "# By hand: events per recipient (reads DATABASE_URL from .env.local without printing it).",
  `DATABASE_URL="$(grep -m1 '^DATABASE_URL=' .env.local | cut -d= -f2- | tr -d "\\"'")"`,
  `psql "$DATABASE_URL" -c "select direction, recipient, count(*), sum(ref_count) as values_, max(ts) from disclosure_events group by 1, 2 order by 5 desc"`,
].join("\n");

export const disclosureLedgerBase = {
  id: ID,
  title: TITLE,
  howTo: DISCLOSURE_LEDGER_HOW_TO,
} as const;

const links = [
  {
    label: "Why: privacy design, #140",
    href: "/docs/privacy-design#25-140-disclosure-ledger",
  },
  { label: "Every entry: Customize · Privacy", href: "/customize/privacy" },
] as const;

export type DisclosureLedgerInput = Readonly<{
  /** The chain walk, or null when the table could not be read. */
  chain: VerifyChainResult | null;
  /** Totals per recipient, or null while this viewer's data is locked. */
  totals: readonly RecipientTotal[] | null;
  /** Configured channels the ledger cannot itemise. */
  outside: readonly string[];
}>;

const eventsCell = (total: RecipientTotal): string =>
  total.syntheticEvents === 0
    ? formatNumber(total.events, 0)
    : `${formatNumber(total.events, 0)} (${formatNumber(total.syntheticEvents, 0)} synthetic)`;

const bytesCell = (total: RecipientTotal): string =>
  total.unmeasured === total.events
    ? "not measured"
    : total.unmeasured === 0
      ? formatBytes(total.bytes)
      : `${formatBytes(total.bytes)} + ${formatNumber(total.unmeasured, 0)} not measured`;

export const recipientRows = (
  totals: readonly RecipientTotal[],
): readonly (readonly string[])[] =>
  totals.map((total) => [
    total.recipient,
    directionLabel(total.direction),
    eventsCell(total),
    formatNumber(total.refs, 0),
    bytesCell(total),
    formatTimestamp(total.last),
  ]);

export const disclosureLedgerCheck = (input: DisclosureLedgerInput): LabCheck => {
  const { chain, totals, outside } = input;
  if (chain === null) {
    return {
      ...disclosureLedgerBase,
      status: "unknown",
      summary:
        "The disclosure ledger could not be read just now. Check that the database is running and migrated (`bun run db:deploy`).",
      evidence: [],
      links,
    };
  }
  const broken = chain.brokenAtSeq;
  const evidence = [
    {
      label: "Rows checked",
      value: `${formatNumber(chain.checked, 0)} of ${formatNumber(chain.total, 0)}`,
    },
    {
      label: "First broken link",
      value: broken === null ? "none" : `row ${broken}`,
      mono: broken !== null,
    },
    { label: "Latest hash", value: shortHash(chain.latestHash, 16), mono: true },
    {
      label: "Outside the ledger",
      value: outside.length === 0 ? "none configured" : outside.join(", "),
    },
  ];
  const table =
    totals === null || totals.length === 0
      ? undefined
      : {
          caption: "Running totals per recipient",
          columns: ["Recipient", "Direction", "Events", "Values", "Size", "Last"],
          rows: recipientRows(totals),
        };
  const locked = totals === null ? " Unlock your data to see who received what." : "";
  if (broken !== null) {
    return {
      ...disclosureLedgerBase,
      status: "not-ok",
      summary: `Row ${broken} of the ledger does not match its hash or its link to the row before. Rows after it were not checked.${locked}`,
      evidence,
      ...(table === undefined ? {} : { table }),
      links,
    };
  }
  if (chain.total === 0) {
    return {
      ...disclosureLedgerBase,
      status: "unknown",
      summary:
        "The ledger has no rows yet: nothing has been sent to a hosted model, a wearable vendor, an export file or another recipient since it was added, so there is no chain to check.",
      evidence,
      links,
    };
  }
  return {
    ...disclosureLedgerBase,
    status: "ok",
    summary: `${plural(chain.total, "event")} in the ledger, and each one hashes correctly and points at the one before. Each was written before its data was sent.${locked}`,
    evidence,
    ...(table === undefined ? {} : { table }),
    links,
  };
};
