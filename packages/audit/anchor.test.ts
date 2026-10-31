import { describe, expect, test } from "bun:test";
import { generateKeyPairSync, type KeyObject } from "node:crypto";

import {
  ANCHOR_CHAIN_WORDS,
  type AnchorLine,
  anchorBody,
  anchorSentence,
  anchorVerdict,
  type ChainAtAnchor,
  type ChainHead,
  checkAnchorLog,
  compareWithAnchor,
  keyBody,
  keyIdOf,
  lineHash,
  parseLine,
  planAnchor,
  publicKeyText,
  rotationBody,
  scanAnchorLog,
  serializeLine,
  signatureHolds,
  signLine,
  splitLines,
} from "./anchor";
import type { ChainName } from "./chain";
import { GENESIS_PREV_HASH, sha256Hex } from "./hash";

// Keys are made fresh for each run; no key material is written in this file.
type Pair = Readonly<{ privateKey: KeyObject; publicKey: string; keyId: string }>;

const newPair = (): Pair => {
  const pair = generateKeyPairSync("ed25519");
  const publicKey = publicKeyText(pair.publicKey);
  return { privateKey: pair.privateKey, publicKey, keyId: keyIdOf(publicKey) };
};

const AT = "2026-10-31T12:00:00.000Z";
const rowHash = (chain: string, seq: number): string => sha256Hex(`${chain}-row-${seq}`);
const head = (chain: ChainName, seq: number): ChainHead => ({
  seq,
  hash: rowHash(chain, seq),
  ts: AT,
});

/** Builds a file line by line, each linked to the one before. */
const fileOf = (makers: readonly ((prev: string) => AnchorLine)[]): readonly string[] =>
  makers.reduce<{ prev: string; lines: string[] }>(
    (acc, make) => {
      const line = make(acc.prev);
      return {
        prev: lineHash(line),
        lines: [...acc.lines, serializeLine(line).trimEnd()],
      };
    },
    { prev: GENESIS_PREV_HASH, lines: [] },
  ).lines;

const keyLine = (pair: Pair) => (prev: string) =>
  signLine(keyBody({ publicKey: pair.publicKey, at: AT, prev }), pair.privateKey);

const anchorLine =
  (pair: Pair, chain: ChainName, seq: number, signer: Pair = pair) =>
  (prev: string) =>
    signLine(
      anchorBody({ chain, head: head(chain, seq), at: AT, keyId: pair.keyId, prev }),
      signer.privateKey,
    );

const rotationLine = (from: Pair | null, to: Pair) => (prev: string) =>
  signLine(
    rotationBody({
      oldKeyId: from?.keyId ?? null,
      newPublicKey: to.publicKey,
      at: AT,
      prev,
    }),
    (from ?? to).privateKey,
  );

const known = (...pairs: readonly Pair[]) =>
  new Map(pairs.map((pair) => [pair.keyId, pair.publicKey]));

const facts = (
  chain: ChainName,
  headSeq: number | null,
  atSeq?: number,
): ChainAtAnchor => ({
  head: headSeq === null ? null : head(chain, headSeq),
  hashAtSeq: atSeq === undefined ? null : rowHash(chain, atSeq),
});

describe("records", () => {
  test("a signed line verifies under its key and not after a change", () => {
    const a = newPair();
    const line = anchorLine(a, "audit", 4)(GENESIS_PREV_HASH);
    expect(signatureHolds(line, a.publicKey)).toBe(true);
    expect(signatureHolds({ ...line, seq: 5 }, a.publicKey)).toBe(false);
    expect(signatureHolds(line, newPair().publicKey)).toBe(false);
  });

  test("a line survives serializing and parsing; a damaged one does not parse", () => {
    const a = newPair();
    const line = keyLine(a)(GENESIS_PREV_HASH);
    expect(parseLine(serializeLine(line))).toEqual(line);
    expect(parseLine("{not json")).toBe(null);
    expect(parseLine(JSON.stringify({ ...line, extra: 1 }))).toBe(null);
    expect(splitLines("a\nb\n")).toEqual(["a", "b"]);
  });

  test("the key id is the SHA-256 of the public key bytes", () => {
    const a = newPair();
    expect(a.keyId).toMatch(/^[0-9a-f]{64}$/);
    expect(keyIdOf(a.publicKey)).toBe(a.keyId);
    expect(newPair().keyId).not.toBe(a.keyId);
  });
});

describe("checkAnchorLog", () => {
  test("a key line and anchors for both chains hold; the newest anchor per chain wins", () => {
    const a = newPair();
    const lines = fileOf([
      keyLine(a),
      anchorLine(a, "audit", 3),
      anchorLine(a, "disclosures", 1),
      anchorLine(a, "audit", 7),
    ]);
    const check = checkAnchorLog(lines, known(a));
    expect(check.ok).toBe(true);
    expect(check.state.lines).toBe(4);
    expect(check.state.latest.audit?.seq).toBe(7);
    expect(check.state.latest.disclosures?.seq).toBe(1);
    expect(check.state.keyIds).toEqual([a.keyId]);
  });

  test("a removed line in the middle breaks the link", () => {
    const a = newPair();
    const lines = fileOf([
      keyLine(a),
      anchorLine(a, "audit", 3),
      anchorLine(a, "audit", 5),
      anchorLine(a, "audit", 7),
    ]);
    const check = checkAnchorLog([lines[0], lines[1], lines[3]], known(a));
    expect(check.ok ? null : check.problem).toEqual({ line: 3, reason: "bad-link" });
  });

  test("a line signed by another key, or changed after signing, is a bad signature", () => {
    const a = newPair();
    const b = newPair();
    const forged = fileOf([keyLine(a), anchorLine(a, "audit", 3, b)]);
    const forgedCheck = checkAnchorLog(forged, known(a, b));
    expect(forgedCheck.ok ? null : forgedCheck.problem).toEqual({
      line: 2,
      reason: "bad-signature",
    });

    const lines = fileOf([keyLine(a), anchorLine(a, "audit", 3)]);
    const edited = JSON.stringify({ ...JSON.parse(lines[1]), seq: 30 });
    const editedCheck = checkAnchorLog([lines[0], edited], known(a));
    expect(editedCheck.ok ? null : editedCheck.problem).toEqual({
      line: 2,
      reason: "bad-signature",
    });
  });

  test("a first key this machine does not know is refused", () => {
    const a = newPair();
    const check = checkAnchorLog(fileOf([keyLine(a)]), known(newPair()));
    expect(check.ok ? null : check.problem).toEqual({ line: 1, reason: "unknown-key" });
  });

  test("an anchor before the key line, and a second key line, are refused", () => {
    const a = newPair();
    const early = checkAnchorLog(fileOf([anchorLine(a, "audit", 1)]), known(a));
    expect(early.ok ? null : early.problem).toEqual({ line: 1, reason: "no-key-line" });
    const twice = checkAnchorLog(fileOf([keyLine(a), keyLine(a)]), known(a));
    expect(twice.ok ? null : twice.problem).toEqual({
      line: 2,
      reason: "second-key-line",
    });
  });

  test("a rotation signed by the old key carries trust to the new one", () => {
    const a = newPair();
    const b = newPair();
    const lines = fileOf([
      keyLine(a),
      anchorLine(a, "audit", 3),
      rotationLine(a, b),
      anchorLine(b, "audit", 9),
    ]);
    const check = checkAnchorLog(lines, known(a));
    expect(check.ok).toBe(true);
    expect(check.state.key?.keyId).toBe(b.keyId);
    expect(check.state.keyIds).toEqual([a.keyId, b.keyId]);
    expect(check.state.breaks).toEqual([]);
    expect(check.state.latest.audit?.seq).toBe(9);
  });

  test("after a rotation the old key may not sign anchors", () => {
    const a = newPair();
    const b = newPair();
    const lines = fileOf([keyLine(a), rotationLine(a, b), anchorLine(a, "audit", 4)]);
    const check = checkAnchorLog(lines, known(a, b));
    expect(check.ok ? null : check.problem).toEqual({ line: 3, reason: "unknown-key" });
  });

  test("a rotation without the old key starts over there and is recorded as a break", () => {
    const lost = newPair();
    const b = newPair();
    const lines = fileOf([
      keyLine(lost),
      anchorLine(lost, "audit", 3),
      rotationLine(null, b),
      anchorLine(b, "audit", 8),
    ]);
    // The lost key's public half is gone too: its lines cannot be checked.
    const check = checkAnchorLog(lines, known(b));
    expect(check.ok).toBe(true);
    expect(check.state.breaks).toEqual([3]);
    expect(check.state.key?.keyId).toBe(b.keyId);
    expect(check.state.latest.audit?.seq).toBe(8);
  });

  test("a rotation without the old key needs the new key on this machine", () => {
    const b = newPair();
    const check = checkAnchorLog(fileOf([rotationLine(null, b)]), known());
    expect(check.ok ? null : check.problem).toEqual({ line: 1, reason: "unknown-key" });
  });
});

describe("scanAnchorLog", () => {
  test("the newest anchor per chain, the last line's hash and the current key", () => {
    const a = newPair();
    const b = newPair();
    const lines = fileOf([keyLine(a), anchorLine(a, "audit", 2), rotationLine(a, b)]);
    const scan = scanAnchorLog(lines);
    expect(scan?.latest.audit?.seq).toBe(2);
    expect(scan?.keyId).toBe(b.keyId);
    expect(scan?.prev).toBe(sha256Hex(lines[2]));
    expect(scanAnchorLog([...lines, "damaged"])).toBe(null);
    expect(scanAnchorLog([])).toEqual({
      prev: GENESIS_PREV_HASH,
      latest: {},
      keyId: null,
    });
  });
});

describe("compareWithAnchor and planAnchor", () => {
  const anchor = { seq: 5, hash: rowHash("audit", 5) };

  test("a chain at or past its anchor with the same hash matches", () => {
    expect(compareWithAnchor(anchor, facts("audit", 5, 5))).toBe("matches");
    expect(compareWithAnchor(anchor, facts("audit", 9, 5))).toBe("matches");
  });

  test("truncation: the head is behind the anchor, or the table is empty", () => {
    expect(compareWithAnchor(anchor, facts("audit", 3, undefined))).toBe("truncated");
    expect(compareWithAnchor(anchor, facts("audit", null))).toBe("truncated");
  });

  test("rewrite: the row at the anchor has another hash; removal: it is gone", () => {
    expect(
      compareWithAnchor(anchor, {
        head: head("audit", 9),
        hashAtSeq: sha256Hex("rebuilt row 5"),
      }),
    ).toBe("rewritten");
    expect(compareWithAnchor(anchor, facts("audit", 9))).toBe("removed");
  });

  test("a new anchor only when the head moved on from a matching anchor", () => {
    const a = newPair();
    const latest = anchorLine(a, "audit", 5)(GENESIS_PREV_HASH);
    expect(planAnchor(undefined, facts("audit", null))).toBe("empty");
    expect(planAnchor(undefined, facts("audit", 2))).toBe("write");
    expect(planAnchor(latest, facts("audit", 5, 5))).toBe("unchanged");
    expect(planAnchor(latest, facts("audit", 6, 5))).toBe("write");
    expect(planAnchor(latest, facts("audit", 4))).toBe("truncated");
    expect(planAnchor(latest, facts("audit", null))).toBe("truncated");
    expect(
      planAnchor(latest, { head: head("audit", 6), hashAtSeq: sha256Hex("other") }),
    ).toBe("rewritten");
  });
});

describe("anchorVerdict", () => {
  const a = newPair();
  const lines = fileOf([keyLine(a), anchorLine(a, "audit", 5)]);
  const log = { kind: "found", check: checkAnchorLog(lines, known(a)) } as const;
  const key = { kind: "found", keyId: a.keyId } as const;

  test("OK when the signature holds and the chain matches", () => {
    const verdict = anchorVerdict({
      chain: "audit",
      key,
      log,
      facts: facts("audit", 6, 5),
    });
    expect(verdict.status).toBe("ok");
    expect(verdict.anchor?.seq).toBe(5);
    expect(anchorSentence(verdict, ANCHOR_CHAIN_WORDS.audit)).toBe(
      "The audit chain matches its latest signed anchor (row 5).",
    );
  });

  test("truncation and rewrite are Not OK with the reason", () => {
    const truncated = anchorVerdict({
      chain: "audit",
      key,
      log,
      facts: facts("audit", null),
    });
    expect(truncated).toMatchObject({ status: "not-ok", reason: "truncated" });
    expect(anchorSentence(truncated, ANCHOR_CHAIN_WORDS.audit)).toBe(
      "The audit chain is shorter than its latest signed anchor (row 5), so rows were removed from its end.",
    );
    const rewritten = anchorVerdict({
      chain: "audit",
      key,
      log,
      facts: { head: head("audit", 5), hashAtSeq: sha256Hex("rebuilt") },
    });
    expect(rewritten).toMatchObject({ status: "not-ok", reason: "rewritten" });
  });

  test("a bad signature in the file is Not OK with its line", () => {
    const b = newPair();
    const forged = fileOf([keyLine(a), anchorLine(a, "audit", 5, b)]);
    const verdict = anchorVerdict({
      chain: "audit",
      key,
      log: { kind: "found", check: checkAnchorLog(forged, known(a)) },
      facts: facts("audit", 5, 5),
    });
    expect(verdict).toMatchObject({ status: "not-ok", reason: "bad-signature", line: 2 });
    expect(anchorSentence(verdict, ANCHOR_CHAIN_WORDS.audit)).toBe(
      "Line 2 of the anchors file has a signature that does not hold.",
    );
  });

  test("no key, no anchor yet, an unreadable chain: Unknown, never OK", () => {
    expect(
      anchorVerdict({ chain: "audit", key: { kind: "missing" }, log, facts: null }),
    ).toMatchObject({ status: "unknown", reason: "no-key" });
    expect(
      anchorVerdict({ chain: "disclosures", key, log, facts: facts("disclosures", 2) }),
    ).toMatchObject({ status: "unknown", reason: "no-anchor" });
    expect(
      anchorVerdict({
        chain: "disclosures",
        key,
        log,
        facts: facts("disclosures", null),
      }),
    ).toMatchObject({ status: "unknown", reason: "no-anchor" });
    expect(anchorVerdict({ chain: "audit", key, log, facts: null })).toMatchObject({
      status: "unknown",
      reason: "chain-unreadable",
    });
    expect(
      anchorVerdict({ chain: "audit", key, log: { kind: "unreadable" }, facts: null }),
    ).toMatchObject({ status: "unknown", reason: "log-unreadable" });
  });

  test("a missing file next to a key, or a key the file does not end with, is Not OK", () => {
    expect(
      anchorVerdict({ chain: "audit", key, log: { kind: "missing" }, facts: null }),
    ).toMatchObject({ status: "not-ok", reason: "log-missing" });
    expect(
      anchorVerdict({
        chain: "audit",
        key: { kind: "found", keyId: newPair().keyId },
        log,
        facts: facts("audit", 5, 5),
      }),
    ).toMatchObject({ status: "not-ok", reason: "key-mismatch" });
  });

  test("a rotation chain verifies; a break in it is Unknown even when the chain matches", () => {
    const b = newPair();
    const rotated = fileOf([
      keyLine(a),
      anchorLine(a, "audit", 5),
      rotationLine(a, b),
      anchorLine(b, "audit", 6),
    ]);
    expect(
      anchorVerdict({
        chain: "audit",
        key: { kind: "found", keyId: b.keyId },
        log: { kind: "found", check: checkAnchorLog(rotated, known(a)) },
        facts: facts("audit", 6, 6),
      }).status,
    ).toBe("ok");

    const c = newPair();
    const broken = fileOf([
      keyLine(a),
      anchorLine(a, "audit", 5),
      rotationLine(null, c),
      anchorLine(c, "audit", 6),
    ]);
    const verdict = anchorVerdict({
      chain: "audit",
      key: { kind: "found", keyId: c.keyId },
      log: { kind: "found", check: checkAnchorLog(broken, known(a, c)) },
      facts: facts("audit", 6, 6),
    });
    expect(verdict).toMatchObject({
      status: "unknown",
      reason: "continuity-break",
      line: 3,
    });
  });
});
