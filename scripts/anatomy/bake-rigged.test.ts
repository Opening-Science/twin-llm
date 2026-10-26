import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import { type DemoBodyId } from "../../packages/anatomy/demo-bodies";
import {
  RIGGED_BODIES,
  type RiggedBodyEntry,
} from "../../packages/anatomy/rigged-bodies";

import { runBakeRigged, type BakeDeps } from "./bake-rigged";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Tiny synthetic "bakes" with honest pins, so no Python run is needed. */
const BAKED: Record<RiggedBodyEntry["sex"], Uint8Array> = {
  male: new Uint8Array([1, 2, 3]),
  female: new Uint8Array([4, 5]),
};

const SYNTHETIC: Record<DemoBodyId, RiggedBodyEntry> = {
  "anny-adult-m": {
    ...RIGGED_BODIES["anny-adult-m"],
    bytes: 3,
    sha256: sha256(BAKED.male),
  },
  "anny-adult-f": {
    ...RIGGED_BODIES["anny-adult-f"],
    bytes: 2,
    sha256: sha256(BAKED.female),
  },
};

const harness = (
  options: Readonly<{
    bakes?: Partial<Record<RiggedBodyEntry["sex"], Uint8Array>>;
    uv?: boolean;
    installed?: Record<string, Uint8Array>;
  }> = {},
) => {
  const files: Record<string, Uint8Array> = { ...options.installed };
  const baked: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: BakeDeps = {
    bake: async (sex, path) => {
      if (options.uv === false) return null;
      baked.push(sex);
      const bytes = (options.bakes ?? BAKED)[sex];
      if (!bytes) return 1;
      files[path] = bytes;
      return 0;
    },
    readFile: async (path) => files[path] ?? null,
    writeFileAtomic: async (path, bytes) => {
      files[path] = bytes;
    },
    mkdir: async () => undefined,
    scratchFile: async (name) => `/scratch/${name}`,
    sha256,
    dir: "/anatomy",
    rigged: SYNTHETIC,
  };
  const io = {
    stdout: { write: (chunk: string) => void out.push(chunk) },
    stderr: { write: (chunk: string) => void err.push(chunk) },
  };
  return { deps, io, files, baked, out, err };
};

describe("runBakeRigged", () => {
  test("bakes both bodies and installs the bytes that match their pins", async () => {
    const h = harness();
    expect(await runBakeRigged([], h.io, h.deps)).toBe(0);
    expect(h.baked).toEqual(["male", "female"]);
    expect(h.files["/anatomy/anny-adult-m.rigged.glb"]).toEqual(BAKED.male);
    expect(h.files["/anatomy/anny-adult-f.rigged.glb"]).toEqual(BAKED.female);
    expect(h.err).toEqual([]);
  });

  test("a bake that differs from the pin writes nothing and names what it got", async () => {
    const wrong = new Uint8Array([9, 9, 9]);
    const h = harness({ bakes: { male: wrong } });
    expect(await runBakeRigged(["--demo", "anny-adult-m"], h.io, h.deps)).toBe(1);
    expect(h.files["/anatomy/anny-adult-m.rigged.glb"]).toBeUndefined();
    expect(h.err).toEqual([
      `ANNY adult (male), rigged: the bake gave 3 bytes, SHA-256 ${sha256(wrong)}, which is not the pin; nothing written.\n`,
    ]);
  });

  test("an installed body is not baked again, and --check bakes nothing", async () => {
    const h = harness({
      installed: { "/anatomy/anny-adult-f.rigged.glb": BAKED.female },
    });
    expect(await runBakeRigged(["--check"], h.io, h.deps)).toBe(1);
    expect(h.baked).toEqual([]);
    expect(h.out.slice(0, 2)).toEqual([
      "ANNY adult (male), rigged: not installed.\n",
      "ANNY adult (female), rigged: already installed.\n",
    ]);
  });

  test("says when uv is missing and rejects unknown ids", async () => {
    const h = harness({ uv: false });
    expect(await runBakeRigged(["--demo", "anny-adult-f"], h.io, h.deps)).toBe(1);
    expect(h.err).toEqual([
      "Baking ANNY adult (female), rigged needs uv (https://docs.astral.sh/uv/).\n",
    ]);
    const bad = harness();
    expect(await runBakeRigged(["--demo", "anny-child"], bad.io, bad.deps)).toBe(2);
    expect(bad.err).toEqual([
      'Unknown demo body "anny-child". Known: anny-adult-m, anny-adult-f.\n',
    ]);
  });
});
