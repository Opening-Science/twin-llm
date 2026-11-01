import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  type AnchorPlan,
  type AnchorRecord,
  type AnchorVerdict,
  anchorVerdict,
  type ChainAtAnchor,
  type ChainHead,
  type DatabaseRead,
  databaseIdOf,
  planAnchor,
} from "./anchor";
import {
  type AnchorPaths,
  type DueHead,
  diskKeyOf,
  latestAnchors,
  readAnchorKey,
  readAnchorLog,
} from "./anchor-store";
import { CHAINS, type ChainName } from "./chain";

/**
 * The database side of the anchors (#300): each chain's head and the hash
 * at one `seq`, read through Prisma. Used by the server's writer, the
 * `anchor:*` commands, `verify-cli` and the Lab cards, so all of them
 * compare the same things.
 */

export type ChainReader = Readonly<{
  head: () => Promise<ChainHead | null>;
  hashAt: (seq: number) => Promise<string | null>;
}>;

type HeadRow = Readonly<{ seq: bigint; hash: string; ts: Date }> | null;

const headOf = (row: HeadRow): ChainHead | null =>
  row === null
    ? null
    : { seq: Number(row.seq), hash: row.hash, ts: row.ts.toISOString() };

export type AnchorClient = Pick<
  PrismaClient,
  "auditEvent" | "disclosureEvent" | "anchorIdentity"
>;

/**
 * This database's identity for the anchors (#382), as `databaseIdOf` hashes
 * it. `read` never writes; `ensure` writes the random id on first use (the
 * first anchor) and returns the stored one when it is already there.
 */
export type DatabaseIdentity = Readonly<{
  read: () => Promise<string | null>;
  ensure: () => Promise<string>;
}>;

export const databaseIdentity = (
  client: Pick<PrismaClient, "anchorIdentity">,
): DatabaseIdentity => {
  const read = async (): Promise<string | null> => {
    const row = await client.anchorIdentity.findUnique({
      where: { id: 1 },
      select: { databaseId: true },
    });
    return row === null ? null : databaseIdOf(row.databaseId);
  };
  return {
    read,
    ensure: async () => {
      await client.anchorIdentity.createMany({
        data: [{ id: 1, databaseId: randomUUID() }],
        skipDuplicates: true,
      });
      const id = await read();
      if (id === null) throw new Error("the database identity could not be written");
      return id;
    },
  };
};

/** The identity as the verdict takes it; unreadable when the read fails. */
export const readDatabase = async (identity: DatabaseIdentity): Promise<DatabaseRead> => {
  try {
    const databaseId = await identity.read();
    return databaseId === null ? { kind: "none" } : { kind: "found", databaseId };
  } catch {
    return { kind: "unreadable" };
  }
};

export const chainReaders = (
  client: AnchorClient,
): Readonly<Record<ChainName, ChainReader>> => ({
  audit: {
    head: async () =>
      headOf(
        await client.auditEvent.findFirst({
          orderBy: { seq: "desc" },
          select: { seq: true, hash: true, ts: true },
        }),
      ),
    hashAt: async (seq) =>
      (
        await client.auditEvent.findUnique({
          where: { seq: BigInt(seq) },
          select: { hash: true },
        })
      )?.hash ?? null,
  },
  disclosures: {
    head: async () =>
      headOf(
        await client.disclosureEvent.findFirst({
          orderBy: { seq: "desc" },
          select: { seq: true, hash: true, ts: true },
        }),
      ),
    hashAt: async (seq) =>
      (
        await client.disclosureEvent.findUnique({
          where: { seq: BigInt(seq) },
          select: { hash: true },
        })
      )?.hash ?? null,
  },
});

/** The chain where `anchor` points (head only without one); null when it cannot be read. */
export const factsAt = async (
  reader: ChainReader,
  anchor: Readonly<{ seq: number }> | null | undefined,
): Promise<ChainAtAnchor | null> => {
  try {
    const head = await reader.head();
    const hashAtSeq = anchor == null ? null : await reader.hashAt(anchor.seq);
    return { head, hashAtSeq };
  } catch {
    return null;
  }
};

export type ChainPlan = Readonly<{
  chain: ChainName;
  plan: AnchorPlan | "unreadable";
  head: ChainHead | null;
}>;

/** What each chain needs now, from the newest anchors in the file. */
export const planAnchors = async (
  readers: Readonly<Record<ChainName, ChainReader>>,
  latest: Readonly<Partial<Record<ChainName, AnchorRecord>>>,
): Promise<readonly ChainPlan[]> =>
  Promise.all(
    CHAINS.map(async (chain): Promise<ChainPlan> => {
      const facts = await factsAt(readers[chain], latest[chain]);
      return facts === null
        ? { chain, plan: "unreadable", head: null }
        : { chain, plan: planAnchor(latest[chain], facts), head: facts.head };
    }),
  );

export const dueHeads = (plans: readonly ChainPlan[]): readonly DueHead[] =>
  plans.flatMap(({ chain, plan, head }) =>
    plan === "write" && head !== null ? [{ chain, head }] : [],
  );

/** Plans from the file at `paths`. */
export const planFromFile = (
  readers: Readonly<Record<ChainName, ChainReader>>,
  paths: AnchorPaths,
): Promise<readonly ChainPlan[]> => planAnchors(readers, latestAnchors(paths));

/** One chain checked against its latest anchor, signatures and all. */
export const verifyAgainstAnchor = async (
  reader: ChainReader,
  identity: DatabaseIdentity,
  paths: AnchorPaths,
  chain: ChainName,
): Promise<AnchorVerdict> => {
  const key = diskKeyOf(readAnchorKey(paths));
  const log = readAnchorLog(paths);
  const anchor = log.kind === "found" ? log.check.state.latest[chain] : undefined;
  return anchorVerdict({
    chain,
    key,
    log,
    facts: await factsAt(reader, anchor),
    database: await readDatabase(identity),
  });
};
