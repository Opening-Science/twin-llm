import { NextResponse } from "next/server";

import { keyframeClipSchema } from "./keyframe-clip";
import { MOTION_CLIP_NOT_INSTALLED_API, MOTION_CLIP_UNREADABLE_API } from "./motion-copy";
import {
  isMotionClipId,
  MOTION_CLIP_IDS,
  type MotionClipId,
  type MotionClipStatus,
} from "./motion-clips";

/**
 * GET /api/motion/status and GET /api/motion/clip/:clipId, as factories so
 * tests pass fakes. Clips are local files made from videos on this machine, so
 * nothing is cached by the browser or a proxy. A clip is checked against the
 * schema before it is served; a broken file is logged and answered with a
 * plain sentence, never the parser's message.
 */
const NO_STORE = { "Cache-Control": "no-store" };

export type MotionStatusDeps = Readonly<{
  statClip: (id: MotionClipId) => Promise<boolean>;
}>;

export const createMotionStatusHandler = (deps: MotionStatusDeps) => async () => {
  const clips = await Promise.all(
    MOTION_CLIP_IDS.map(async (id) => ({ id, installed: await deps.statClip(id) })),
  );
  const body: MotionClipStatus = { clips };
  return NextResponse.json(body, { headers: NO_STORE });
};

export type MotionClipDeps = Readonly<{
  readClip: (id: MotionClipId) => Promise<string | null>;
}>;

type RouteContext = { params: Promise<unknown> };

export const createMotionClipHandler =
  (deps: MotionClipDeps) => async (_request: Request, context: RouteContext) => {
    const params = (await context.params) as Record<string, unknown>;
    const id = params.clipId;
    if (!isMotionClipId(id)) {
      return NextResponse.json(
        { error: "Not found." },
        { status: 404, headers: NO_STORE },
      );
    }
    const text = await deps.readClip(id);
    if (text === null) {
      return NextResponse.json(
        { error: MOTION_CLIP_NOT_INSTALLED_API, installed: false },
        { status: 404, headers: NO_STORE },
      );
    }
    const parsed = (() => {
      try {
        return keyframeClipSchema.safeParse(JSON.parse(text));
      } catch (error) {
        return { success: false as const, error };
      }
    })();
    if (!parsed.success) {
      console.error(`[motion] clip ${id} is not a valid clip`, parsed.error);
      return NextResponse.json(
        { error: MOTION_CLIP_UNREADABLE_API },
        { status: 500, headers: NO_STORE },
      );
    }
    return NextResponse.json(parsed.data, {
      headers: { ...NO_STORE, "X-Content-Type-Options": "nosniff" },
    });
  };
