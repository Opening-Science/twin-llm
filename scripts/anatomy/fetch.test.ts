import { createHash } from "node:crypto";

import { describe, expect, test } from "bun:test";

import {
  DEMO_BODIES,
  type DemoBodyEntry,
  type DemoBodyId,
} from "../../packages/anatomy/demo-bodies";
import { ATLASES, type AtlasEntry, type AtlasId } from "../../packages/anatomy/manifest";

import { runAnatomyFetch, type FetchDeps } from "./fetch";

const sha256 = (bytes: Uint8Array): string =>
  createHash("sha256").update(bytes).digest("hex");

/** Synthetic tiny "atlases" with honest pins, so no real download is needed. */
const BYTES: Record<AtlasId, Uint8Array> = {
  bodyparts3d: new Uint8Array([1, 2, 3, 4]),
  "hra-f": new Uint8Array([5, 6, 7]),
  "hra-m": new Uint8Array([8, 9]),
};

const SYNTHETIC: Record<AtlasId, AtlasEntry> = {
  bodyparts3d: { ...ATLASES.bodyparts3d, bytes: 4, sha256: sha256(BYTES.bodyparts3d) },
  "hra-f": { ...ATLASES["hra-f"], bytes: 3, sha256: sha256(BYTES["hra-f"]) },
  "hra-m": { ...ATLASES["hra-m"], bytes: 2, sha256: sha256(BYTES["hra-m"]) },
};

const DEMO_BYTES: Record<DemoBodyId, Uint8Array> = {
  "anny-adult-m": new Uint8Array([10, 11, 12]),
  "anny-adult-f": new Uint8Array([13, 14]),
};

const SYNTHETIC_DEMO: Record<DemoBodyId, DemoBodyEntry> = {
  "anny-adult-m": {
    ...DEMO_BODIES["anny-adult-m"],
    bytes: 3,
    sha256: sha256(DEMO_BYTES["anny-adult-m"]),
  },
  "anny-adult-f": {
    ...DEMO_BODIES["anny-adult-f"],
    bytes: 2,
    sha256: sha256(DEMO_BYTES["anny-adult-f"]),
  },
};

const harness = (
  serve: (url: string) => Response,
  existing: Record<string, Uint8Array> = {},
) => {
  const written: Record<string, Uint8Array> = {};
  const requested: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  const deps: FetchDeps = {
    fetch: async (url, init) => {
      requested.push(url);
      expect(init.redirect).toBe("error");
      return serve(url);
    },
    readFile: async (path) => existing[path] ?? written[path] ?? null,
    writeFileAtomic: async (path, bytes) => {
      written[path] = bytes;
    },
    mkdir: async () => undefined,
    sha256,
    dir: "/atlases",
    atlases: SYNTHETIC,
    demoBodies: SYNTHETIC_DEMO,
  };
  const io = {
    stdout: { write: (chunk: string) => void out.push(chunk) },
    stderr: { write: (chunk: string) => void err.push(chunk) },
  };
  return { deps, io, written, requested, out, err };
};

const byUrl = (url: string): Response => {
  const id = (Object.keys(SYNTHETIC) as AtlasId[]).find(
    (key) => SYNTHETIC[key].url === url,
  );
  const demoId = (Object.keys(SYNTHETIC_DEMO) as DemoBodyId[]).find(
    (key) => SYNTHETIC_DEMO[key].url === url,
  );
  if (id) return new Response(BYTES[id]);
  if (demoId) return new Response(DEMO_BYTES[demoId]);
  return new Response("missing", { status: 404 });
};

describe("runAnatomyFetch", () => {
  test("downloads, verifies and writes every atlas and demo body, then prints the credits", async () => {
    const h = harness(byUrl);
    expect(await runAnatomyFetch([], h.io, h.deps)).toBe(0);
    expect(Object.keys(h.written).sort()).toEqual([
      "/atlases/anny-adult-f.pose-bodyparts3d.glb",
      "/atlases/anny-adult-m.pose-bodyparts3d.glb",
      "/atlases/bodyparts3d.ao.glb",
      "/atlases/hra-m.ao.glb",
      "/atlases/hra.ao.glb",
    ]);
    expect(h.out.join("")).toContain("ANNY adult (female): installed (0.0 MB).");
    expect(h.out.join("").split(DEMO_BODIES["anny-adult-m"].attribution).length).toBe(2);
    const output = h.out.join("");
    expect(output).toContain("BodyParts3D: installed (0.0 MB).");
    expect(output).toContain(ATLASES.bodyparts3d.attribution);
    expect(output).toContain(ATLASES["hra-f"].attribution);
    expect(output.split(ATLASES["hra-f"].attribution).length).toBe(2);
    expect(output).toContain("written confirmation is still pending");
  });

  test("writes nothing when the checksum does not match", async () => {
    const h = harness(() => new Response(new Uint8Array([9, 9, 9, 9])));
    expect(await runAnatomyFetch(["--atlas", "bodyparts3d"], h.io, h.deps)).toBe(1);
    expect(h.written).toEqual({});
    expect(h.err.join("")).toBe("Checksum mismatch for BodyParts3D; nothing written.\n");
  });

  test("stops reading past the pinned size", async () => {
    const h = harness(() => new Response(new Uint8Array([1, 2, 3, 4, 5, 6])));
    expect(await runAnatomyFetch(["--atlas", "hra-m"], h.io, h.deps)).toBe(1);
    expect(h.written).toEqual({});
    expect(h.err.join("")).toBe(
      "HuBMAP HRA (male donor) is larger than its pin; nothing written.\n",
    );
  });

  test("skips an atlas that is already installed", async () => {
    const h = harness(byUrl, { "/atlases/hra.ao.glb": BYTES["hra-f"] });
    expect(await runAnatomyFetch(["--atlas", "hra-f"], h.io, h.deps)).toBe(0);
    expect(h.requested).toEqual([]);
    expect(h.out[0]).toBe("HuBMAP HRA (female donor): already installed.\n");
  });

  test("--check reports without downloading and fails when something is missing", async () => {
    const h = harness(byUrl, { "/atlases/bodyparts3d.ao.glb": BYTES.bodyparts3d });
    expect(await runAnatomyFetch(["--check"], h.io, h.deps)).toBe(1);
    expect(h.requested).toEqual([]);
    expect(h.out.slice(0, 3)).toEqual([
      "BodyParts3D: already installed.\n",
      "HuBMAP HRA (female donor): not installed.\n",
      "HuBMAP HRA (male donor): not installed.\n",
    ]);
  });

  test("reports an HTTP failure plainly", async () => {
    const h = harness(() => new Response("nope", { status: 503 }));
    expect(await runAnatomyFetch(["--atlas", "hra-f"], h.io, h.deps)).toBe(1);
    expect(h.err.join("")).toBe(
      "Could not download HuBMAP HRA (female donor) (HTTP 503).\n",
    );
  });

  test("rejects an unknown atlas id", async () => {
    const h = harness(byUrl);
    expect(await runAnatomyFetch(["--atlas", "z-anatomy"], h.io, h.deps)).toBe(2);
    expect(h.err.join("")).toBe(
      'Unknown atlas "z-anatomy". Known: bodyparts3d, hra-f, hra-m.\n',
    );
  });

  test("a write failure is reported plainly and the next atlas still installs", async () => {
    const h = harness(byUrl);
    const failing = {
      ...h.deps,
      writeFileAtomic: async (path: string, bytes: Uint8Array) => {
        if (path.endsWith("bodyparts3d.ao.glb")) throw new Error("ENOSPC");
        await h.deps.writeFileAtomic(path, bytes);
      },
    };
    expect(await runAnatomyFetch([], h.io, failing)).toBe(1);
    expect(h.err.join("")).toBe("Could not write BodyParts3D to /atlases.\n");
    expect(Object.keys(h.written).sort()).toEqual([
      "/atlases/anny-adult-f.pose-bodyparts3d.glb",
      "/atlases/anny-adult-m.pose-bodyparts3d.glb",
      "/atlases/hra-m.ao.glb",
      "/atlases/hra.ao.glb",
    ]);
  });

  test("--demo fetches only that demo body and credits ANNY alone", async () => {
    const h = harness(byUrl);
    expect(await runAnatomyFetch(["--demo", "anny-adult-f"], h.io, h.deps)).toBe(0);
    expect(h.requested).toEqual([SYNTHETIC_DEMO["anny-adult-f"].url]);
    expect(Object.keys(h.written)).toEqual([
      "/atlases/anny-adult-f.pose-bodyparts3d.glb",
    ]);
    expect(h.out).toEqual([
      "ANNY adult (female): installed (0.0 MB).\n",
      "\nCredit wherever these models are shown:\n",
      `  ${DEMO_BODIES["anny-adult-f"].attribution}\n`,
    ]);
  });

  test("--atlas alone does not fetch demo bodies", async () => {
    const h = harness(byUrl);
    expect(await runAnatomyFetch(["--atlas", "hra-m"], h.io, h.deps)).toBe(0);
    expect(h.requested).toEqual([SYNTHETIC["hra-m"].url]);
  });

  test("a demo body with the wrong bytes writes nothing", async () => {
    const h = harness(() => new Response(new Uint8Array([1, 1, 1])));
    expect(await runAnatomyFetch(["--demo", "anny-adult-m"], h.io, h.deps)).toBe(1);
    expect(h.written).toEqual({});
    expect(h.err.join("")).toBe(
      "Checksum mismatch for ANNY adult (male); nothing written.\n",
    );
  });

  test("rejects an unknown demo body id", async () => {
    const h = harness(byUrl);
    expect(await runAnatomyFetch(["--demo", "smpl-x"], h.io, h.deps)).toBe(2);
    expect(h.err.join("")).toBe(
      'Unknown demo body "smpl-x". Known: anny-adult-m, anny-adult-f.\n',
    );
    expect(h.requested).toEqual([]);
  });
});
