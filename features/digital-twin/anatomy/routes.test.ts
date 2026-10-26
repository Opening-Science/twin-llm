import { describe, expect, test } from "bun:test";

import {
  DEMO_BODIES,
  demoBodyVersion,
  type DemoBodyId,
} from "@/packages/anatomy/demo-bodies";
import { ATLASES, atlasVersion, type AtlasId } from "@/packages/anatomy/manifest";
import { RIGGED_BODIES, riggedBodyApiUrl } from "@/packages/anatomy/rigged-bodies";

import { ANATOMY_NOT_INSTALLED_API } from "./anatomy-copy";
import {
  createAnatomyAtlasHandler,
  createDemoBodyHandler,
  createRiggedBodyHandler,
} from "./atlas-handler";
import { DEMO_NOT_INSTALLED_API, RIGGED_NOT_INSTALLED_API } from "./demo-copy";
import { createAnatomyStatusHandler } from "./status-handler";

const BYTES = new Uint8Array([103, 108, 84, 70, 2, 0, 0, 0]);

const atlasGet = (installed: readonly AtlasId[]) => {
  const opened: AtlasId[] = [];
  const GET = createAnatomyAtlasHandler({
    openAtlas: async (id) => {
      opened.push(id);
      return installed.includes(id) ? BYTES : null;
    },
  });
  const call = (id: string, query = "", headers: Record<string, string> = {}) =>
    GET(new Request(`http://local/api/anatomy/atlas/${id}${query}`, { headers }), {
      params: Promise.resolve({ atlasId: id }),
    });
  return { call, opened };
};

describe("GET /api/anatomy/atlas/:atlasId", () => {
  test("serves an installed atlas with immutable caching for the pinned version", async () => {
    const { call } = atlasGet(["bodyparts3d"]);
    const res = await call("bodyparts3d", `?v=${atlasVersion("bodyparts3d")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("model/gltf-binary");
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${ATLASES.bodyparts3d.sha256}"`);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  test("revalidates when the URL carries no or a stale version", async () => {
    const { call } = atlasGet(["hra-f"]);
    expect((await call("hra-f")).headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    expect((await call("hra-f", "?v=0000")).headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
  });

  test("answers 304 for a matching ETag without reading the file", async () => {
    const { call, opened } = atlasGet(["hra-m"]);
    const res = await call("hra-m", "", {
      "if-none-match": `"${ATLASES["hra-m"].sha256}"`,
    });
    expect(res.status).toBe(304);
    expect(opened).toEqual([]);
  });

  test("weak and listed validators also revalidate", async () => {
    const { call, opened } = atlasGet(["hra-m"]);
    const etag = `"${ATLASES["hra-m"].sha256}"`;
    expect((await call("hra-m", "", { "if-none-match": `W/${etag}` })).status).toBe(304);
    expect(
      (await call("hra-m", "", { "if-none-match": `"other", ${etag}` })).status,
    ).toBe(304);
    expect((await call("hra-m", "", { "if-none-match": '"other"' })).status).toBe(200);
    expect(opened).toEqual(["hra-m"]);
  });

  test("a missing atlas is a plain JSON 404", async () => {
    const { call } = atlasGet([]);
    const res = await call("hra-f");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      error: ANATOMY_NOT_INSTALLED_API,
      installed: false,
    });
  });

  test("an unknown id is 404 and never reaches the store", async () => {
    const { call, opened } = atlasGet(["bodyparts3d"]);
    const res = await call("..%2F..%2Fetc%2Fpasswd");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found." });
    expect(opened).toEqual([]);
  });
});

describe("GET /api/anatomy/status", () => {
  test("lists every atlas with its installed state, uncached", async () => {
    const GET = createAnatomyStatusHandler({ statAtlas: async (id) => id !== "hra-m" });
    const res = await GET();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({
      atlases: [
        { id: "bodyparts3d", installed: true },
        { id: "hra-f", installed: true },
        { id: "hra-m", installed: false },
      ],
      riggedBodies: [
        { id: "anny-adult-m", installed: false },
        { id: "anny-adult-f", installed: false },
      ],
    });
  });

  test("lists which demo bodies have a baked rigged variant", async () => {
    const GET = createAnatomyStatusHandler({
      statAtlas: async () => false,
      statRiggedBody: async (id) => id === "anny-adult-f",
    });
    expect((await (await GET()).json()).riggedBodies).toEqual([
      { id: "anny-adult-m", installed: false },
      { id: "anny-adult-f", installed: true },
    ]);
  });
});

const demoGet = (installed: readonly DemoBodyId[]) => {
  const opened: DemoBodyId[] = [];
  const GET = createDemoBodyHandler({
    openDemoBody: async (id) => {
      opened.push(id);
      return installed.includes(id) ? BYTES : null;
    },
  });
  const call = (id: string, query = "", headers: Record<string, string> = {}) =>
    GET(new Request(`http://local/api/anatomy/demo/${id}${query}`, { headers }), {
      params: Promise.resolve({ bodyId: id }),
    });
  return { call, opened };
};

describe("GET /api/anatomy/demo/:bodyId", () => {
  test("serves an installed demo body with immutable caching for the pinned version", async () => {
    const { call } = demoGet(["anny-adult-f"]);
    const res = await call("anny-adult-f", `?v=${demoBodyVersion("anny-adult-f")}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("model/gltf-binary");
    expect(res.headers.get("content-length")).toBe("8");
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${DEMO_BODIES["anny-adult-f"].sha256}"`);
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(BYTES);
  });

  test("revalidates without a version and answers 304 without reading the file", async () => {
    const { call, opened } = demoGet(["anny-adult-m"]);
    expect((await call("anny-adult-m")).headers.get("cache-control")).toBe(
      "public, max-age=0, must-revalidate",
    );
    const res = await call("anny-adult-m", "", {
      "if-none-match": `"${DEMO_BODIES["anny-adult-m"].sha256}"`,
    });
    expect(res.status).toBe(304);
    expect(opened).toEqual(["anny-adult-m"]);
  });

  test("a missing demo body is a plain JSON 404 that says how to install it", async () => {
    const { call } = demoGet([]);
    const res = await call("anny-adult-m");
    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: DEMO_NOT_INSTALLED_API, installed: false });
  });

  test("atlas ids and unknown ids are 404 and never reach the store", async () => {
    const { call, opened } = demoGet(["anny-adult-m"]);
    expect((await call("bodyparts3d")).status).toBe(404);
    const res = await call("..%2F..%2Fetc%2Fpasswd");
    expect(await res.json()).toEqual({ error: "Not found." });
    expect(opened).toEqual([]);
  });
});

describe("GET /api/anatomy/rigged/:bodyId", () => {
  const riggedGet = (installed: readonly DemoBodyId[]) =>
    createRiggedBodyHandler({
      openRiggedBody: async (id) => (installed.includes(id) ? BYTES : null),
    });
  const call = (GET: ReturnType<typeof riggedGet>, id: string, query = "") =>
    GET(new Request(`http://local/api/anatomy/rigged/${id}${query}`), {
      params: Promise.resolve({ bodyId: id }),
    });

  test("serves a baked rigged body under its own pin", async () => {
    const url = riggedBodyApiUrl("anny-adult-m");
    expect(url).toBe(
      `/api/anatomy/rigged/anny-adult-m?v=${RIGGED_BODIES["anny-adult-m"].sha256.slice(0, 16)}`,
    );
    const res = await call(
      riggedGet(["anny-adult-m"]),
      "anny-adult-m",
      url.slice(url.indexOf("?")),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(res.headers.get("etag")).toBe(`"${RIGGED_BODIES["anny-adult-m"].sha256}"`);
  });

  test("a body that was not baked is a 404 naming the bake command", async () => {
    const res = await call(riggedGet([]), "anny-adult-f");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: RIGGED_NOT_INSTALLED_API,
      installed: false,
    });
  });
});
