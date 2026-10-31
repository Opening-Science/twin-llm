import { describe, expect, test } from "bun:test";

import type { RecipientTotal } from "@/infrastructure/disclosure-ledger";

import { disclosureLedgerCheck, recipientRows } from "./disclosure-ledger-check";

const HASH = "c".repeat(64);
const SOUND = {
  ok: true,
  brokenAtSeq: null,
  checked: 3,
  total: 3,
  latestHash: HASH,
} as const;

const TOTAL: RecipientTotal = {
  recipient: "exoscale",
  direction: "sent",
  events: 3,
  syntheticEvents: 1,
  refs: 12,
  bytes: 24_500,
  unmeasured: 0,
  first: new Date(Date.UTC(2026, 9, 30, 8, 0)),
  last: new Date(Date.UTC(2026, 9, 31, 14, 5)),
  categories: [{ category: "question text", events: 3 }],
};

const ARK: RecipientTotal = {
  ...TOTAL,
  recipient: "this machine, from the Ark",
  direction: "received",
  events: 1,
  syntheticEvents: 0,
  refs: 11,
  bytes: 0,
  unmeasured: 1,
};

describe("disclosureLedgerCheck (#140)", () => {
  test("a sound chain, unlocked: OK with a row per recipient", () => {
    const check = disclosureLedgerCheck({
      chain: SOUND,
      totals: [TOTAL, ARK],
      outside: [],
    });
    expect(check.status).toBe("ok");
    expect(check.title).toBe("What left this machine");
    expect(check.summary).toBe(
      "3 events in the ledger, and each one hashes correctly and points at the one before. Each was written before its data was sent.",
    );
    expect(check.table).toEqual({
      caption: "Running totals per recipient",
      columns: ["Recipient", "Direction", "Events", "Values", "Size", "Last"],
      rows: [
        [
          "exoscale",
          "Sent",
          "3 (1 synthetic)",
          "12",
          "24.5 kB",
          "31 Oct 2026, 14:05 UTC",
        ],
        [
          "this machine, from the Ark",
          "Received",
          "1",
          "11",
          "not measured",
          "31 Oct 2026, 14:05 UTC",
        ],
      ],
    });
    expect(
      check.evidence.find((item) => item.label === "Outside the ledger")?.value,
    ).toBe("none configured");
  });

  test("locked: the chain is checked, the recipients are not shown", () => {
    const check = disclosureLedgerCheck({
      chain: SOUND,
      totals: null,
      outside: ["Clerk sign-in", "Arcjet"],
    });
    expect(check.status).toBe("ok");
    expect(check.table).toBe(undefined);
    expect(check.summary).toEndWith("Unlock your data to see who received what.");
    expect(
      check.evidence.find((item) => item.label === "Outside the ledger")?.value,
    ).toBe("Clerk sign-in, Arcjet");
  });

  test("a broken chain is Not OK at the row that breaks", () => {
    const check = disclosureLedgerCheck({
      chain: { ok: false, brokenAtSeq: 2, checked: 2, total: 3, latestHash: HASH },
      totals: [],
      outside: [],
    });
    expect(check.status).toBe("not-ok");
    expect(check.summary).toStartWith("Row 2 of the ledger does not match");
  });

  test("an empty ledger is Unknown, never OK", () => {
    expect(
      disclosureLedgerCheck({
        chain: { ok: true, brokenAtSeq: null, checked: 0, total: 0, latestHash: null },
        totals: [],
        outside: [],
      }).status,
    ).toBe("unknown");
  });

  test("a table that cannot be read is Unknown", () => {
    expect(disclosureLedgerCheck({ chain: null, totals: null, outside: [] }).status).toBe(
      "unknown",
    );
  });

  test("sizes say when some were not measured", () => {
    expect(recipientRows([{ ...TOTAL, unmeasured: 2 }])[0]?.[4]).toBe(
      "24.5 kB + 2 not measured",
    );
  });
});
