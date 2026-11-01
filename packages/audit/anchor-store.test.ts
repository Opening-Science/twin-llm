import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  anchorBody,
  checkAnchorLog,
  databaseIdOf,
  lineHash,
  parseLine,
  serializeLine,
  signLine,
  splitLines,
} from "./anchor";
import {
  AnchorDatabaseMismatch,
  anchoredDatabase,
  anchorPaths,
  initAnchorKey,
  latestAnchors,
  readAnchorKey,
  readAnchorLog,
  readKnownKeys,
  rotateAnchorKey,
  writeAnchors,
} from "./anchor-store";
import { sha256Hex } from "./hash";

const NOW = new Date(Date.UTC(2026, 9, 31, 12, 0));
const head = (seq: number) => ({
  seq,
  hash: sha256Hex(`row ${seq}`),
  ts: NOW.toISOString(),
});

const DB_A = databaseIdOf("database-a");
const DB_B = databaseIdOf("database-b");

const mode = (path: string): number => statSync(path).mode & 0o777;

describe("anchor store (#300)", () => {
  let stateDir = "";
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "anchor-store-"));
  });
  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  test("init makes an owner-only key and the file's first line, once", () => {
    const paths = anchorPaths(stateDir);
    const created = initAnchorKey(paths, NOW);
    expect(created.kind).toBe("created");
    expect(mode(paths.dir)).toBe(0o700);
    expect(mode(paths.privateKey)).toBe(0o600);
    expect(mode(paths.publicKey)).toBe(0o600);
    expect(mode(paths.log)).toBe(0o600);
    const key = readAnchorKey(paths);
    expect(key.kind === "found" && created.kind === "created" ? key.keyId : null).toBe(
      created.kind === "created" ? created.keyId : "",
    );
    expect(initAnchorKey(paths, NOW)).toEqual({
      kind: "exists",
      keyId: created.kind === "created" ? created.keyId : "",
    });
    const log = readAnchorLog(paths);
    expect(log.kind === "found" ? log.check.ok : false).toBe(true);
  });

  test("anchors append, link and verify; the writer's view sees the newest", () => {
    const paths = anchorPaths(stateDir);
    initAnchorKey(paths, NOW);
    writeAnchors(paths, [{ chain: "audit", head: head(3) }], NOW, DB_A);
    writeAnchors(
      paths,
      [
        { chain: "audit", head: head(5) },
        { chain: "disclosures", head: head(1) },
      ],
      NOW,
      DB_A,
    );
    // The key line, the line naming the database, three anchors.
    expect(splitLines(readFileSync(paths.log, "utf8"))).toHaveLength(5);
    const log = readAnchorLog(paths);
    expect(log.kind === "found" && log.check.ok).toBe(true);
    expect(latestAnchors(paths).audit?.seq).toBe(5);
    expect(latestAnchors(paths).disclosures?.seq).toBe(1);
  });

  test("init refuses when the file is there but the key is gone", () => {
    const paths = anchorPaths(stateDir);
    initAnchorKey(paths, NOW);
    rmSync(paths.privateKey);
    expect(initAnchorKey(paths, NOW).kind).toBe("refused");
    expect(() =>
      writeAnchors(paths, [{ chain: "audit", head: head(1) }], NOW, DB_A),
    ).toThrow("no usable anchor key");
  });

  test("a damaged line stops the writer", () => {
    const paths = anchorPaths(stateDir);
    initAnchorKey(paths, NOW);
    writeFileSync(paths.log, "damaged\n", { flag: "a" });
    expect(() =>
      writeAnchors(paths, [{ chain: "audit", head: head(1) }], NOW, DB_A),
    ).toThrow("a line of the anchors file is damaged");
  });

  test("rotation: the old key signs over, old anchors still verify with the retired key", () => {
    const paths = anchorPaths(stateDir);
    const first = initAnchorKey(paths, NOW);
    writeAnchors(paths, [{ chain: "audit", head: head(3) }], NOW, DB_A);
    const rotated = rotateAnchorKey(paths, NOW, { withoutOldKey: false });
    expect(rotated.kind).toBe("rotated");
    writeAnchors(paths, [{ chain: "audit", head: head(4) }], NOW, DB_A);

    const known = readKnownKeys(paths);
    expect(known.size).toBe(2);
    expect(first.kind === "created" && known.has(first.keyId)).toBe(true);
    const check = checkAnchorLog(splitLines(readFileSync(paths.log, "utf8")), known);
    expect(check.ok).toBe(true);
    expect(check.state.breaks).toEqual([]);
    expect(check.state.key?.keyId).toBe(
      rotated.kind === "rotated" ? rotated.newKeyId : "",
    );
    expect(mode(paths.privateKey)).toBe(0o600);
  });

  test("rotation without the old key leaves a break the check reports", () => {
    const paths = anchorPaths(stateDir);
    initAnchorKey(paths, NOW);
    writeAnchors(paths, [{ chain: "audit", head: head(3) }], NOW, DB_A);
    rmSync(paths.privateKey);
    expect(rotateAnchorKey(paths, NOW, { withoutOldKey: false }).kind).toBe("refused");
    const rotated = rotateAnchorKey(paths, NOW, { withoutOldKey: true });
    expect(rotated.kind).toBe("rotated");
    writeAnchors(paths, [{ chain: "audit", head: head(4) }], NOW, DB_A);
    const log = readAnchorLog(paths);
    expect(log.kind === "found" && log.check.ok).toBe(true);
    expect(log.kind === "found" ? log.check.state.breaks : null).toEqual([4]);
  });

  test("the first write names the database; another database is refused, the file untouched (#382)", () => {
    const paths = anchorPaths(stateDir);
    initAnchorKey(paths, NOW);
    expect(anchoredDatabase(paths)).toBe(null);
    writeAnchors(paths, [{ chain: "audit", head: head(3) }], NOW, DB_A);
    expect(anchoredDatabase(paths)).toBe(DB_A);
    const before = readFileSync(paths.log, "utf8");

    const attempt = () =>
      writeAnchors(paths, [{ chain: "audit", head: head(1) }], NOW, DB_B);
    expect(attempt).toThrow(AnchorDatabaseMismatch);
    try {
      attempt();
    } catch (error) {
      expect(error instanceof AnchorDatabaseMismatch ? error.code : null).toBe(
        "ANCHOR_DATABASE_MISMATCH",
      );
      expect(error instanceof Error ? error.message : "").toContain(DB_A.slice(0, 12));
    }
    expect(readFileSync(paths.log, "utf8")).toBe(before);

    writeAnchors(paths, [{ chain: "audit", head: head(4) }], NOW, DB_A);
    const log = readAnchorLog(paths);
    expect(log.kind === "found" && log.check.ok).toBe(true);
    expect(latestAnchors(paths).audit?.seq).toBe(4);
  });

  test("a file from before #382 keeps verifying and takes the database on its next write", () => {
    const paths = anchorPaths(stateDir);
    initAnchorKey(paths, NOW);
    const key = readAnchorKey(paths);
    if (key.kind !== "found") throw new Error("no key");
    // An anchor written the way #300 wrote it: no line naming a database.
    const [first] = splitLines(readFileSync(paths.log, "utf8"));
    const parsed = first === undefined ? null : parseLine(first);
    if (parsed === null) throw new Error("no key line");
    const legacy = signLine(
      anchorBody({
        chain: "audit",
        head: head(3),
        at: NOW.toISOString(),
        keyId: key.keyId,
        prev: lineHash(parsed),
      }),
      key.privateKey,
    );
    writeFileSync(paths.log, serializeLine(legacy), { flag: "a" });
    const old = readAnchorLog(paths);
    expect(old.kind === "found" && old.check.ok).toBe(true);
    expect(anchoredDatabase(paths)).toBe(null);

    writeAnchors(paths, [{ chain: "audit", head: head(4) }], NOW, DB_B);
    expect(anchoredDatabase(paths)).toBe(DB_B);
    const log = readAnchorLog(paths);
    expect(log.kind === "found" && log.check.ok).toBe(true);
    expect(log.kind === "found" ? log.check.state.databaseId : null).toBe(DB_B);
    expect(() =>
      writeAnchors(paths, [{ chain: "audit", head: head(5) }], NOW, DB_A),
    ).toThrow(AnchorDatabaseMismatch);
  });
});
