import { localDayBounds } from "@/packages/query-tools/replay/local-time";
import type { StoryPhase } from "@/packages/query-tools/replay/phases";
import { belongsTo, type ReplayKey } from "@/packages/query-tools/replay/replay-day";

const DEFAULT_PLAYBACK_DURATION_MS = 300_000;
const FAST_PLAYBACK_DURATION_MS = 45_000;
const STORY_HOLD_DURATION_MS = 3_000;
const SEEK_STEP_MS = 15 * 60_000;

export type ReplaySpeed = "default" | "fast";
type PlaybackStatus = "paused" | "playing" | "ended";

export type ReplaySnapshot = Readonly<{
  selection: ReplayKey;
  startMs: number;
  /** Exclusive next midnight. The cursor never enters the next day. */
  endMs: number;
  cursorMs: number;
  status: PlaybackStatus;
  speed: ReplaySpeed;
  holding: boolean;
}>;

export type ReplayStory = Readonly<{
  selection: ReplayKey;
  phases: readonly Pick<StoryPhase, "from">[];
}>;

export type ReplayFrameClock = Readonly<{
  now: () => number;
  request: (callback: () => void) => number;
  cancel: (id: number) => void;
}>;

export function createReplayTransport(selection: ReplayKey, clock: ReplayFrameClock) {
  const { subject_ref, day, time_zone } = selection;
  const dayBounds = localDayBounds(day, time_zone);
  const dayStartMs = dayBounds.start.getTime();
  const dayEndMs = dayBounds.end.getTime();
  const lastCursorMs = dayEndMs - 1;
  const listeners = new Set<() => void>();
  let snapshot: ReplaySnapshot = {
    selection: { subject_ref, day, time_zone },
    startMs: dayStartMs,
    endMs: dayEndMs,
    cursorMs: dayStartMs,
    status: "paused",
    speed: "default",
    holding: false,
  };
  const initialSnapshot = snapshot;
  let connected = false;
  let replayCursorMs = dayStartMs;
  let lastClockMs = 0;
  let holdRemainingMs = 0;
  let storyStartTimesMs: number[] = [];
  let scheduledFrameId: number | null = null;
  let frameGeneration = 0;

  function publish(status: PlaybackStatus, speed = snapshot.speed) {
    const cursorMs = Math.floor(replayCursorMs);
    const holding = holdRemainingMs > 0;
    if (
      snapshot.cursorMs === cursorMs &&
      snapshot.status === status &&
      snapshot.speed === speed &&
      snapshot.holding === holding
    ) {
      return;
    }
    snapshot = { ...snapshot, cursorMs, status, speed, holding };
    for (const listener of listeners) listener();
  }

  function advance(clockMs: number): PlaybackStatus {
    let elapsedMs = clockMs - lastClockMs;
    lastClockMs = clockMs;
    if (holdRemainingMs > 0) {
      const elapsedHoldMs = Math.min(holdRemainingMs, elapsedMs);
      holdRemainingMs -= elapsedHoldMs;
      elapsedMs -= elapsedHoldMs;
      if (holdRemainingMs > 0) return "playing";
    }
    const isFastPlayback = snapshot.speed === "fast";
    const playbackBudgetWithoutHoldsMs = isFastPlayback
      ? FAST_PLAYBACK_DURATION_MS
      : Math.max(
          FAST_PLAYBACK_DURATION_MS,
          DEFAULT_PLAYBACK_DURATION_MS -
            storyStartTimesMs.length * STORY_HOLD_DURATION_MS,
        );
    const targetCursorMs =
      replayCursorMs +
      (elapsedMs * (dayEndMs - dayStartMs)) / playbackBudgetWithoutHoldsMs;
    if (!isFastPlayback) {
      const nextStoryStartMs = storyStartTimesMs.find(
        (startMs) => startMs > replayCursorMs,
      );
      if (nextStoryStartMs !== undefined && nextStoryStartMs <= targetCursorMs) {
        replayCursorMs = nextStoryStartMs;
        // Start the hold when consumers see the card, even if the frame arrived late.
        holdRemainingMs = STORY_HOLD_DURATION_MS;
        return "playing";
      }
    }
    replayCursorMs = Math.min(lastCursorMs, targetCursorMs);
    return replayCursorMs === lastCursorMs ? "ended" : "playing";
  }

  function schedule() {
    if (!connected || snapshot.status !== "playing" || scheduledFrameId !== null) return;
    const requestedGeneration = ++frameGeneration;
    scheduledFrameId = clock.request(() => {
      if (requestedGeneration !== frameGeneration) return;
      scheduledFrameId = null;
      publish(advance(clock.now()));
      schedule();
    });
  }

  function cancel() {
    frameGeneration += 1;
    if (scheduledFrameId !== null) clock.cancel(scheduledFrameId);
    scheduledFrameId = null;
  }

  function seek(requestedCursorMs: number) {
    if (!connected) return;
    if (!Number.isFinite(requestedCursorMs))
      throw new RangeError("Replay seek requires a finite timestamp");
    replayCursorMs = Math.min(
      lastCursorMs,
      Math.max(dayStartMs, Math.trunc(requestedCursorMs)),
    );
    holdRemainingMs = 0;
    lastClockMs = clock.now();
    publish(
      snapshot.status === "ended" && replayCursorMs < lastCursorMs
        ? "paused"
        : snapshot.status,
    );
  }

  function start() {
    lastClockMs = clock.now();
    publish(advance(lastClockMs));
    schedule();
  }

  function replay() {
    if (!connected) return;
    replayCursorMs = dayStartMs;
    holdRemainingMs = 0;
    start();
  }

  return {
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect() {
      connected = true;
      return () => {
        connected = false;
        cancel();
        holdRemainingMs = 0;
        if (snapshot.status === "playing") publish("paused");
        else publish(snapshot.status);
      };
    },
    setStory(story: ReplayStory | null) {
      const updatedStoryStartTimesMs =
        story !== null && belongsTo(story.selection, snapshot.selection)
          ? [...new Set(story.phases.map(({ from }) => Date.parse(from)))]
              // Don't hold at midnight: Play and Replay should move on the first frame.
              .filter((startMs) => startMs > dayStartMs && startMs < dayEndMs)
              .sort((a, b) => a - b)
          : [];
      if (
        updatedStoryStartTimesMs.length === storyStartTimesMs.length &&
        updatedStoryStartTimesMs.every(
          (startMs, index) => startMs === storyStartTimesMs[index],
        )
      )
        return;
      const status =
        snapshot.status === "playing" ? advance(clock.now()) : snapshot.status;
      storyStartTimesMs = updatedStoryStartTimesMs;
      if (holdRemainingMs > 0 && !storyStartTimesMs.includes(replayCursorMs))
        holdRemainingMs = 0;
      if (status === "ended") cancel();
      publish(status);
    },
    actions: {
      play() {
        if (!connected || snapshot.status === "playing") return;
        if (replayCursorMs === lastCursorMs) replay();
        else start();
      },
      pause() {
        if (!connected || snapshot.status !== "playing") return;
        const status = advance(clock.now());
        cancel();
        publish(status === "ended" ? status : "paused");
      },
      setSpeed(speed: ReplaySpeed) {
        if (!connected || speed === snapshot.speed) return;
        const status =
          snapshot.status === "playing" ? advance(clock.now()) : snapshot.status;
        if (speed === "fast") holdRemainingMs = 0;
        if (status === "ended") cancel();
        publish(status, speed);
      },
      replay,
      seek,
      step(direction: -1 | 1) {
        seek(snapshot.cursorMs + direction * SEEK_STEP_MS);
      },
    },
  };
}
