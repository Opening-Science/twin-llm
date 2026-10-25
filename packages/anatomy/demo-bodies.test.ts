import { describe, expect, test } from "bun:test";

import {
  DEMO_BODIES,
  DEMO_BODY_IDS,
  demoBodyApiUrl,
  demoBodyIdFor,
  demoBodyVersion,
  isDemoBodyId,
} from "./demo-bodies";

describe("DEMO_BODIES", () => {
  test("every pinned body is complete and consistent", () => {
    expect(Object.keys(DEMO_BODIES)).toEqual([...DEMO_BODY_IDS]);
    for (const id of DEMO_BODY_IDS) {
      const entry = DEMO_BODIES[id];
      expect(entry.id).toBe(id);
      expect(entry.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(entry.fileName).toBe(`${id}.pose-bodyparts3d.glb`);
      expect(entry.url).toBe(`https://opentwin.opening.science/models/${entry.fileName}`);
    }
  });

  test("pins match the files verified on 2026-10-15", () => {
    expect(DEMO_BODIES["anny-adult-m"].bytes).toBe(108_908);
    expect(DEMO_BODIES["anny-adult-m"].sha256).toBe(
      "c1723196c2075a7cfb26e4ca6311119c098e031d88ba5c2ba05b5f40cfe9de2b",
    );
    expect(DEMO_BODIES["anny-adult-f"].bytes).toBe(110_004);
    expect(DEMO_BODIES["anny-adult-f"].sha256).toBe(
      "72947c1fdcfc8df272f511989d587f04a2fd2d9a3a35d675a3e8bc0aaf75e190",
    );
    expect(DEMO_BODIES["anny-adult-m"].heightM).toBe(1.914);
    expect(DEMO_BODIES["anny-adult-f"].heightM).toBe(1.772);
  });

  test("the credit is the verbatim open-twin-xr attribution", () => {
    const anny =
      "ANNY, a free-to-use 3D human parametric model for all ages — NAVER LABS Europe / NAVER Corporation. Apache-2.0 code over CC0 shape assets derived from MakeHuman. Cite arXiv:2511.03589. Baked to static geometry by this repository; no scan of any person was used.";
    expect(DEMO_BODIES["anny-adult-m"].attribution).toBe(anny);
    expect(DEMO_BODIES["anny-adult-f"].attribution).toBe(anny);
  });

  test("version, API url and sex choice derive from the pin", () => {
    expect(demoBodyVersion("anny-adult-m")).toBe("c1723196c2075a7c");
    expect(demoBodyApiUrl("anny-adult-f")).toBe(
      "/api/anatomy/demo/anny-adult-f?v=72947c1fdcfc8df2",
    );
    expect(demoBodyIdFor("male")).toBe("anny-adult-m");
    expect(demoBodyIdFor("female")).toBe("anny-adult-f");
  });

  test("isDemoBodyId accepts only the closed set", () => {
    expect(isDemoBodyId("anny-adult-f")).toBe(true);
    expect(isDemoBodyId("anny")).toBe(false);
    expect(isDemoBodyId("bodyparts3d")).toBe(false);
    expect(isDemoBodyId("../../etc/passwd")).toBe(false);
    expect(isDemoBodyId(null)).toBe(false);
  });
});
