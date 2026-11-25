import { expect, test } from "bun:test";

import {
  activeTimelineEvents,
  snapTimelineSeek,
  timelineSegments,
  type TimelineEvent,
} from "./your-day-replay-events";

const minute = 60_000;
const event = (
  id: string,
  start: number,
  end: number,
  kind: TimelineEvent["kind"],
): TimelineEvent => ({
  id,
  start: start * minute,
  end: end * minute,
  kind,
  label: id,
  source: "Fixture",
});

test("renders one continuous track with clipped intervals, overlap priority, and quiet gaps", () => {
  const events = [
    event("sleep", -5, 15, "sleep"),
    event("run", 5, 10, "workout"),
    event("heart", 12, 18, "heart"),
  ];
  const track = timelineSegments(events, 0, 20 * minute);
  expect(
    track.map(({ start, end, event }) => [start / minute, end / minute, event?.id]),
  ).toEqual([
    [0, 5, "sleep"],
    [5, 10, "run"],
    [10, 15, "sleep"],
    [15, 20, undefined],
  ]);
});

test("orders overlapping events consistently and switches at exclusive interval ends", () => {
  const events = [
    event("heart", 3, 10, "heart"),
    event("running", 5, 6, "workout"),
    event("walking", 5, 8, "activity"),
  ];
  expect(activeTimelineEvents(events, 5 * minute).map(({ id }) => id)).toEqual([
    "running",
    "walking",
    "heart",
  ]);
  expect(activeTimelineEvents(events, 6 * minute).map(({ id }) => id)).toEqual([
    "walking",
    "heart",
  ]);
  expect(activeTimelineEvents(events, 12 * minute)).toEqual([]);
});

test("snaps close to the nearest start but preserves free seeking and day boundaries", () => {
  const events = [event("sleep", -30, 20, "sleep"), event("walking", 35, 40, "activity")];
  const seek = (at: number) => snapTimelineSeek(at * minute, events, 0, 60 * minute);
  expect(seek(2)).toBe(0);
  expect(seek(33)).toBe(35 * minute);
  expect(seek(25)).toBe(25 * minute);
  expect(seek(60)).toBe(60 * minute);
});
