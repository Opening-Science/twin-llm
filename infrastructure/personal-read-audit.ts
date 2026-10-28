import type { AppendInput } from "@/packages/audit/append";

/**
 * The audit row for a route or page that reads a person's own data outside
 * the model tools (#143): which read it was and how many rows it returned.
 * Never a value, a unit, a date or a hash of one. The tool name is
 * `personal.read.<purpose>`, so the chain says what the read was for.
 * A wearable sync (`sync`) reads from the provider and writes a snapshot; its
 * row counts the metrics written (#223).
 *
 * `personalReadEvent` is pure; `auditPersonalRead` wires it to an append the
 * caller passes in, so a handler takes it as a dep and a test passes a fake.
 * The caller appends before the data goes out and does not send it if the
 * append fails, like any other personal read.
 */

export const PERSONAL_READ_PURPOSES = [
  "wearables-summary",
  "genome-report",
  "connectors-page",
  "sync",
] as const;

export type PersonalReadPurpose = (typeof PERSONAL_READ_PURPOSES)[number];

export const PERSONAL_READ_TOOL_PREFIX = "personal.read." as const;

export const personalReadTool = (purpose: PersonalReadPurpose): string =>
  `${PERSONAL_READ_TOOL_PREFIX}${purpose}`;

export type PersonalRead = Readonly<{
  actor: string;
  purpose: PersonalReadPurpose;
  rowCount: number;
  /** Defaults to the actor, as the other route reads do. */
  sessionId?: string;
  subjectRef?: string | null;
}>;

export const personalReadEvent = (read: PersonalRead): AppendInput => ({
  actor: read.actor,
  sessionId: read.sessionId ?? read.actor,
  subjectRef: read.subjectRef ?? null,
  tool: personalReadTool(read.purpose),
  args: { purpose: read.purpose },
  result: { rowCount: read.rowCount },
  rowCount: read.rowCount,
});

export const auditPersonalRead =
  (append: (input: AppendInput) => Promise<unknown>) =>
  (read: PersonalRead): Promise<unknown> =>
    append(personalReadEvent(read));
