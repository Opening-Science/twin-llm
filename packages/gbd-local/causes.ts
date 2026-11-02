/**
 * Lookups over the GBD cause table (cause-table.ts): a cause's level in the
 * GBD cause hierarchy by id (#409). Pure. An id the table does not hold has
 * no level; nothing is guessed.
 */
import { GBD_CAUSE_TABLE, type GbdCauseEntry } from "./cause-table";

export type GbdCause = Readonly<{
  id: number;
  parentId: number | null;
  /** 0 All causes; 1 e.g. Non-communicable diseases; 2 e.g. Cardiovascular diseases; 3; 4. */
  level: number;
  /** The source package's snake_case key, not IHME's display name. */
  name: string;
}>;

const toCause = ([id, parentId, level, name]: GbdCauseEntry): GbdCause => ({
  id,
  parentId,
  level,
  name,
});

const BY_ID: ReadonlyMap<number, GbdCause> = new Map(
  GBD_CAUSE_TABLE.map((entry) => [entry[0], toCause(entry)]),
);

export const gbdCauseById = (id: number): GbdCause | null => BY_ID.get(id) ?? null;

/** The cause's level in the GBD hierarchy, or null when the table does not hold its id. */
export const gbdCauseLevel = (id: number): number | null => BY_ID.get(id)?.level ?? null;
