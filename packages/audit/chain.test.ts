import { describe, expect, test } from "bun:test";

import { checkLinks, firstBrokenLink, hashLink, nextLink } from "./chain";
import { GENESIS_PREV_HASH, hashEvent, sha256Hex, toCanonicalJson } from "./hash";

type Row = Readonly<{ seq: bigint; name: string; prevHash: string; hash: string }>;

const rehash = (row: Row): string =>
  hashLink(row.prevHash, {
    name: row.name,
    prev_hash: row.prevHash,
    seq: Number(row.seq),
  });

const chainOf = (names: readonly string[]): readonly Row[] =>
  names.reduce<readonly Row[]>((rows, name) => {
    const { seq, prevHash } = nextLink(rows.at(-1) ?? null);
    const row = { seq, name, prevHash, hash: "" };
    return [...rows, { ...row, hash: rehash(row) }];
  }, []);

describe("the shared chain (#140)", () => {
  test("a link is SHA-256 of the previous hash and the canonical JSON", () => {
    expect(hashLink(GENESIS_PREV_HASH, { b: 2, a: 1 })).toBe(
      sha256Hex(`${GENESIS_PREV_HASH}{"a":1,"b":2}`),
    );
  });

  test("the audit hash is the same link over the audit row", () => {
    const event = {
      actor: "local",
      args_sha256: sha256Hex("args"),
      prev_hash: GENESIS_PREV_HASH,
      result_sha256: sha256Hex("result"),
      row_count: 0,
      seq: 1,
      session_id: "s",
      subject_ref: null,
      tool: "list_subjects",
      ts: "2026-10-31T00:00:00.000Z",
    };
    expect(hashEvent(event)).toBe(sha256Hex(GENESIS_PREV_HASH + toCanonicalJson(event)));
    expect(hashEvent(event)).toBe(hashLink(GENESIS_PREV_HASH, event));
  });

  test("the first row follows the genesis hash, the next one the last row", () => {
    expect(nextLink(null)).toEqual({ seq: 1n, prevHash: GENESIS_PREV_HASH });
    expect(nextLink({ seq: 4n, hash: "h4" })).toEqual({ seq: 5n, prevHash: "h4" });
  });

  test("a sound chain holds; a changed row or a broken link is found", () => {
    const rows = chainOf(["a", "b", "c"]);
    expect(checkLinks(rows, rehash)).toEqual({
      ok: true,
      brokenAtSeq: null,
      checked: 3,
      total: 3,
      latestHash: rows[2]?.hash ?? null,
    });
    const edited = rows.map((row, index) => (index === 1 ? { ...row, name: "B" } : row));
    expect(checkLinks(edited, rehash)).toEqual({
      ok: false,
      brokenAtSeq: 2,
      checked: 2,
      total: 3,
      latestHash: rows[2]?.hash ?? null,
    });
    const relinked = rows.map((row, index) =>
      index === 2 ? { ...row, prevHash: GENESIS_PREV_HASH } : row,
    );
    expect(firstBrokenLink(relinked, rehash)).toBe(2);
    expect(firstBrokenLink(rows.slice(1), rehash, rows[0]?.hash)).toBe(-1);
  });
});
