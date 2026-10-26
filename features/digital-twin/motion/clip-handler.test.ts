import { describe, expect, test } from "bun:test";

import { createMotionClipHandler, createMotionStatusHandler } from "./clip-handler";
import fixture from "./fixtures/synthetic-clip.json";
import { MOTION_CLIP_NOT_INSTALLED_API, MOTION_CLIP_UNREADABLE_API } from "./motion-copy";
import { clipInstalled, isMotionClipId, type MotionClipId } from "./motion-clips";
import { COMPUTED_CLIPS, offeredClips } from "./use-body-motion";
import { parseKeyframeClip, type KeyframeClip } from "./keyframe-clip";

const call = (
  readClip: (id: MotionClipId) => Promise<string | null>,
  id: string,
): Promise<Response> =>
  createMotionClipHandler({ readClip })(
    new Request(`http://local/api/motion/clip/${id}`),
    { params: Promise.resolve({ clipId: id }) },
  );

describe("GET /api/motion/status", () => {
  test("lists each known clip and whether it is on this machine, uncached", async () => {
    const res = await createMotionStatusHandler({ statClip: async () => true })();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ clips: [{ id: "video-dance", installed: true }] });
  });
});

describe("GET /api/motion/clip/:clipId", () => {
  test("serves an installed clip after checking it", async () => {
    const res = await call(async () => JSON.stringify(fixture), "video-dance");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as typeof fixture;
    expect(body.name).toBe("Synthetic sway");
    expect(body.frameCount).toBe(12);
  });

  test("a missing clip is a 404 that says how to make one", async () => {
    const res = await call(async () => null, "video-dance");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: MOTION_CLIP_NOT_INSTALLED_API,
      installed: false,
    });
  });

  test("an unknown id never reaches the store", async () => {
    const asked: string[] = [];
    const res = await call(async (id) => {
      asked.push(id);
      return null;
    }, "../../etc/passwd");
    expect(res.status).toBe(404);
    expect(asked).toEqual([]);
  });

  test("a broken file is a plain 500, not the parser's words", async () => {
    const logged: unknown[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => void logged.push(args[0]);
    try {
      for (const text of ["{not json", JSON.stringify({ ...fixture, frameCount: 3 })]) {
        const res = await call(async () => text, "video-dance");
        expect(res.status).toBe(500);
        expect(await res.json()).toEqual({ error: MOTION_CLIP_UNREADABLE_API });
      }
    } finally {
      console.error = original;
    }
    expect(logged).toEqual([
      "[motion] clip video-dance is not a valid clip",
      "[motion] clip video-dance is not a valid clip",
    ]);
  });
});

describe("motion clip list", () => {
  test("only known ids, and only an explicit installed: true counts", () => {
    expect([
      isMotionClipId("video-dance"),
      isMotionClipId("x"),
      isMotionClipId(3),
    ]).toEqual([true, false, false]);
    expect(
      clipInstalled({ clips: [{ id: "video-dance", installed: true }] }, "video-dance"),
    ).toBe(true);
    expect(
      clipInstalled({ clips: [{ id: "video-dance", installed: "yes" }] }, "video-dance"),
    ).toBe(false);
    expect(clipInstalled(null, "video-dance")).toBe(false);
  });

  test("the toolbar offers Dance (video) only once a clip has loaded", () => {
    const clip = parseKeyframeClip(fixture) as KeyframeClip;
    expect(offeredClips(null)).toEqual(["walk", "run", "idle", "dance"]);
    expect(offeredClips(clip)).toEqual([...COMPUTED_CLIPS, "video"]);
  });
});
