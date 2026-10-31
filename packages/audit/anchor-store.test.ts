import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { checkAnchorLog, splitLines } from "./anchor";
import {
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
    writeAnchors(paths, [{ chain: "audit", head: head(3) }], NOW);
    writeAnchors(
      paths,
      [
        { chain: "audit", head: head(5) },
        { chain: "disclosures", head: head(1) },
      ],
      NOW,
    );
    expect(splitLines(readFileSync(paths.log, "utf8"))).toHaveLength(4);
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
    expect(() => writeAnchors(paths, [{ chain: "audit", head: head(1) }], NOW)).toThrow(
      "no usable anchor key",
    );
  });

  test("a damaged line stops the writer", () => {
    const paths = anchorPaths(stateDir);
    initAnchorKey(paths, NOW);
    writeFileSync(paths.log, "damaged\n", { flag: "a" });
    expect(() => writeAnchors(paths, [{ chain: "audit", head: head(1) }], NOW)).toThrow(
      "a line of the anchors file is damaged",
    );
  });

  test("rotation: the old key signs over, old anchors still verify with the retired key", () => {
    const paths = anchorPaths(stateDir);
    const first = initAnchorKey(paths, NOW);
    writeAnchors(paths, [{ chain: "audit", head: head(3) }], NOW);
    const rotated = rotateAnchorKey(paths, NOW, { withoutOldKey: false });
    expect(rotated.kind).toBe("rotated");
    writeAnchors(paths, [{ chain: "audit", head: head(4) }], NOW);

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
    writeAnchors(paths, [{ chain: "audit", head: head(3) }], NOW);
    rmSync(paths.privateKey);
    expect(rotateAnchorKey(paths, NOW, { withoutOldKey: false }).kind).toBe("refused");
    const rotated = rotateAnchorKey(paths, NOW, { withoutOldKey: true });
    expect(rotated.kind).toBe("rotated");
    writeAnchors(paths, [{ chain: "audit", head: head(4) }], NOW);
    const log = readAnchorLog(paths);
    expect(log.kind === "found" && log.check.ok).toBe(true);
    expect(log.kind === "found" ? log.check.state.breaks : null).toEqual([3]);
  });
});
