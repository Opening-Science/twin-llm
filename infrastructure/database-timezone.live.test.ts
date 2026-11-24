import { afterAll, beforeAll, describe, expect, test } from "bun:test";

import { PrismaClient } from "@/generated/prisma/client";

import { postgresAdapter } from "./database-adapter";

/**
 * Times in the `timestamptz` chat tables survive a database whose default
 * time zone is not UTC, as a local cluster's is. The database default is set
 * to Europe/Zurich for this file and reset afterwards.
 *   RUN_LIVE=1 DATABASE_URL=<throwaway, migrated> bun test infrastructure/database-timezone.live.test.ts
 */

const runLive = Reflect.get(process.env, "RUN_LIVE") === "1";
const url = String(Reflect.get(process.env, "DATABASE_URL") ?? "");

const USER = "tz-live-user";

/** Each side of the Zurich clock changes, and a plain winter and summer time. */
const INSTANTS = [
  "2026-03-29T00:30:00.000Z", // 01:30 CET, before the spring change
  "2026-03-29T02:30:00.000Z", // 04:30 CEST; 02:30 is a Zurich time that never happens
  "2026-10-24T12:00:00.000Z", // summer, CEST
  "2026-10-25T00:30:00.000Z", // 02:30 CEST, the first 02:30 of 25 October
  "2026-10-25T01:30:00.000Z", // 02:30 CET, the second
  "2026-11-20T12:00:00.000Z", // winter, CET
] as const;

const openClient = (): PrismaClient =>
  new PrismaClient({ adapter: postgresAdapter(url) });

/** What Postgres holds for a conversation's start, as a UTC ISO string. */
const heldStart = async (db: PrismaClient, id: string): Promise<string> => {
  const rows = await db.$queryRaw<{ held: string }[]>`
    SELECT to_char(started_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS held
      FROM conversations WHERE id = ${id}`;
  return rows[0]?.held ?? "missing";
};

describe.skipIf(!runLive)("timestamptz through the app's client (RUN_LIVE=1)", () => {
  const admin = openClient();
  const state: { db: PrismaClient | null; database: string } = { db: null, database: "" };
  const db = (): PrismaClient => {
    if (state.db === null) throw new Error("client not opened");
    return state.db;
  };

  beforeAll(async () => {
    const [row] = await admin.$queryRaw<
      { name: string }[]
    >`SELECT current_database() AS name`;
    state.database = row?.name ?? "";
    await admin.$executeRawUnsafe(
      `ALTER DATABASE "${state.database}" SET timezone = 'Europe/Zurich'`,
    );
    // Opened after the change, so its connections start with the Zurich default.
    state.db = openClient();
    await db().user.create({ data: { id: USER, clerkId: USER } });
  });

  afterAll(async () => {
    await db().thread.deleteMany({ where: { userId: USER } });
    await db().conversation.deleteMany({ where: { ownerId: USER } });
    await db().user.deleteMany({ where: { id: USER } });
    await db().$disconnect();
    await admin.$executeRawUnsafe(`ALTER DATABASE "${state.database}" RESET timezone`);
    await admin.$disconnect();
  });

  test("the session is UTC whatever the database default or the URL asks", async () => {
    const [plain] = await admin.$queryRaw<{ zone: string }[]>`
      SELECT setting AS zone FROM pg_db_role_setting s
        CROSS JOIN LATERAL unnest(s.setconfig) AS setting
       WHERE s.setdatabase = (SELECT oid FROM pg_database WHERE datname = current_database())`;
    expect(plain?.zone).toBe("TimeZone=Europe/Zurich");
    const [session] = await db().$queryRaw<{ zone: string }[]>`
      SELECT current_setting('TimeZone') AS zone`;
    expect(session?.zone).toBe("UTC");
    const join = url.includes("?") ? "&" : "?";
    const asking = new PrismaClient({
      adapter: postgresAdapter(`${url}${join}options=-c%20TimeZone%3DEurope%2FZurich`),
    });
    const [asked] = await asking.$queryRaw<{ zone: string }[]>`
      SELECT current_setting('TimeZone') AS zone`;
    await asking.$disconnect();
    expect(asked?.zone).toBe("UTC");
  });

  test("a time the app writes is the instant Postgres holds and reads back", async () => {
    const results = [];
    for (const [index, iso] of INSTANTS.entries()) {
      const id = `tz-write-${index}`;
      await db().conversation.create({
        data: {
          id,
          ownerId: USER,
          titleSealed: "made up",
          startedAt: new Date(iso),
          lastActivityAt: new Date(iso),
        },
      });
      const read = await db().conversation.findUniqueOrThrow({ where: { id } });
      results.push({
        held: await heldStart(db(), id),
        read: read.startedAt.toISOString(),
      });
    }
    expect(results).toEqual(INSTANTS.map((iso) => ({ held: iso, read: iso })));
  });

  test("a time copied back to an old UTC column keeps the same instant", async () => {
    const results = [];
    for (const [index, iso] of INSTANTS.entries()) {
      const id = `tz-copy-${index}`;
      // The reverse trigger copies it with `AT TIME ZONE 'UTC'`.
      await db().conversation.create({
        data: {
          id,
          ownerId: USER,
          titleSealed: "made up",
          startedAt: new Date(iso),
          lastActivityAt: new Date(iso),
        },
      });
      const read = await db().thread.findUniqueOrThrow({ where: { id } });
      const [held] = await db().$queryRaw<{ held: string }[]>`
        SELECT to_char("createdAt", 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS held
          FROM threads WHERE id = ${id}`;
      results.push({ held: held?.held ?? "missing", read: read.createdAt.toISOString() });
    }
    expect(results).toEqual(INSTANTS.map((iso) => ({ held: iso, read: iso })));
  });
});
