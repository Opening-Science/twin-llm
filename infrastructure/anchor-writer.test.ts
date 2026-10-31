import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChainHead } from "@/packages/audit/anchor";
import type { ChainReader } from "@/packages/audit/anchor-chains";
import { anchorPaths, initAnchorKey, latestAnchors } from "@/packages/audit/anchor-store";
import type { ChainName } from "@/packages/audit/chain";
import { sha256Hex } from "@/packages/audit/hash";

import { createAnchorWriter } from "./anchor-writer";

/** A chain in memory: rows 1..length, each with a hash made from its number. */
const fakeChain = (salt: string) => {
  const state = { length: 0, salt };
  const hashOf = (seq: number) => sha256Hex(`${state.salt}-${seq}`);
  const reader: ChainReader = {
    head: async (): Promise<ChainHead | null> =>
      state.length === 0
        ? null
        : {
            seq: state.length,
            hash: hashOf(state.length),
            ts: "2026-10-31T12:00:00.000Z",
          },
    hashAt: async (seq) => (seq >= 1 && seq <= state.length ? hashOf(seq) : null),
  };
  return { state, reader };
};

describe("createAnchorWriter (#300)", () => {
  let stateDir = "";
  beforeEach(() => {
    stateDir = mkdtempSync(join(tmpdir(), "anchor-writer-"));
  });
  afterEach(() => {
    rmSync(stateDir, { recursive: true, force: true });
  });

  const setup = (intervalMs: number) => {
    const audit = fakeChain("audit");
    const disclosures = fakeChain("disclosures");
    const clock = { ms: Date.UTC(2026, 9, 31, 12, 0) };
    const logged: string[] = [];
    const paths = anchorPaths(stateDir);
    const writer = createAnchorWriter({
      readers: { audit: audit.reader, disclosures: disclosures.reader } as Record<
        ChainName,
        ChainReader
      >,
      paths,
      intervalMs,
      now: () => new Date(clock.ms),
      log: (line) => logged.push(line),
    });
    return { audit, disclosures, clock, logged, paths, writer };
  };

  test("without a key it writes nothing and says so once", async () => {
    const { audit, logged, writer } = setup(60_000);
    audit.state.length = 2;
    expect(await writer.poll()).toEqual([]);
    expect(await writer.poll()).toEqual([]);
    expect(logged).toEqual([
      "[anchor] no anchor key, so no anchors are written; run bun run anchor:init",
    ]);
  });

  test("writes when a head moved, at most once per interval; flush writes the rest", async () => {
    const { audit, disclosures, clock, paths, writer } = setup(10 * 60_000);
    initAnchorKey(paths, new Date(clock.ms));
    audit.state.length = 3;
    await writer.poll();
    expect(latestAnchors(paths).audit?.seq).toBe(3);
    expect(latestAnchors(paths).disclosures).toBe(undefined);

    audit.state.length = 5;
    disclosures.state.length = 1;
    clock.ms += 60_000;
    await writer.poll();
    expect(latestAnchors(paths).audit?.seq).toBe(3);

    expect(writer.flush()).toBe(2);
    expect(latestAnchors(paths).audit?.seq).toBe(5);
    expect(latestAnchors(paths).disclosures?.seq).toBe(1);
    expect(writer.flush()).toBe(0);

    clock.ms += 10 * 60_000;
    const plans = await writer.poll();
    expect(plans.map((plan) => plan.plan)).toEqual(["unchanged", "unchanged"]);
  });

  test("never anchors over a truncated or rebuilt chain", async () => {
    const { audit, clock, logged, paths, writer } = setup(60_000);
    initAnchorKey(paths, new Date(clock.ms));
    audit.state.length = 4;
    await writer.poll();
    audit.state.length = 2;
    clock.ms += 60_000;
    const plans = await writer.poll();
    expect(plans[0]?.plan).toBe("truncated");
    expect(latestAnchors(paths).audit?.seq).toBe(4);

    audit.state.length = 6;
    audit.state.salt = "rebuilt";
    clock.ms += 60_000;
    expect((await writer.poll())[0]?.plan).toBe("rewritten");
    expect(latestAnchors(paths).audit?.seq).toBe(4);
    expect(logged).toEqual([
      "[anchor] the audit chain does not match its latest anchor (truncated); no new anchor is written over it",
      "[anchor] the audit chain does not match its latest anchor (rewritten); no new anchor is written over it",
    ]);
  });
});
