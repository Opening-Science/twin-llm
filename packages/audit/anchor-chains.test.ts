import { describe, expect, test } from "bun:test";

import { databaseIdOf } from "./anchor";
import { databaseIdentity, readDatabase } from "./anchor-chains";

/** The one `anchor_identity` row in memory, with the two calls the identity makes. */
const fakeClient = () => {
  const table: { row: { id: number; databaseId: string } | null; creates: number } = {
    row: null,
    creates: 0,
  };
  const client = {
    anchorIdentity: {
      findUnique: async () =>
        table.row === null ? null : { databaseId: table.row.databaseId },
      createMany: async (input: {
        data: readonly { id: number; databaseId: string }[];
      }) => {
        table.creates += 1;
        const [first] = input.data;
        if (table.row === null && first !== undefined) table.row = { ...first };
        return { count: 1 };
      },
    },
  };
  return { table, client };
};

describe("databaseIdentity (#382)", () => {
  test("read never writes; ensure writes a random id once and then keeps it", async () => {
    const { table, client } = fakeClient();
    // The fake carries only the two calls used; the cast stands for the Prisma client.
    const identity = databaseIdentity(
      client as unknown as Parameters<typeof databaseIdentity>[0],
    );
    expect(await identity.read()).toBe(null);
    expect(table.creates).toBe(0);
    expect(await readDatabase(identity)).toEqual({ kind: "none" });

    const first = await identity.ensure();
    expect(table.row?.databaseId).toMatch(/^[0-9a-f-]{36}$/);
    expect(first).toBe(databaseIdOf(table.row?.databaseId ?? ""));
    expect(await identity.ensure()).toBe(first);
    expect(await readDatabase(identity)).toEqual({ kind: "found", databaseId: first });
  });

  test("a read that fails is unreadable, not none", async () => {
    const identity = {
      read: async () => {
        throw new Error("relation does not exist");
      },
      ensure: async () => "",
    };
    expect(await readDatabase(identity)).toEqual({ kind: "unreadable" });
  });
});
