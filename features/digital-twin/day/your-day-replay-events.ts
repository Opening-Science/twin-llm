import { type ReplayDay, type ReplayKey } from "@/packages/query-tools/replay/replay-day";
import { type StoryPhase } from "@/packages/query-tools/replay/phases";

export const EVENT_KINDS = ["workout", "activity", "sleep", "heart", "glucose"] as const;
export type TimelineKind = (typeof EVENT_KINDS)[number];
export type TimelineEvent = Readonly<{
  id: string;
  kind: TimelineKind;
  label: string;
  start: number;
  end: number;
  source: string;
}>;

export type YourDayReplayData = Readonly<{
  selection: ReplayKey;
  notice: string | null;
  events: readonly TimelineEvent[];
  phases: readonly Pick<StoryPhase, "from">[];
}>;

export function replayTimeline(
  day: ReplayDay,
  phases: readonly StoryPhase[],
): YourDayReplayData {
  const intervals = day.events.flatMap((event): TimelineEvent[] => {
    if (event.kind !== "sleep" && event.kind !== "activity") return [];
    return [
      {
        id: `event:${event.id}`,
        kind: event.activity === "run" ? "workout" : event.kind,
        label: event.label,
        start: Date.parse(event.from),
        end: Date.parse(event.to),
        source: `${event.source.name} · ${event.provenance}`,
      },
    ];
  });
  const markers = phases.map((phase): TimelineEvent => ({
    id: `phase:${phase.id}`,
    kind: phase.stream === "heart_rate" ? "heart" : "glucose",
    label: phase.label,
    start: Date.parse(phase.from),
    end: Date.parse(phase.to),
    source: `Derived · ${phase.rule.text}`,
  }));
  const { subject_ref, day: date, time_zone, notice } = day;
  return {
    selection: { subject_ref, day: date, time_zone },
    notice,
    events: [...intervals, ...markers].sort(
      (a, b) =>
        a.start - b.start ||
        EVENT_KINDS.indexOf(a.kind) - EVENT_KINDS.indexOf(b.kind) ||
        a.id.localeCompare(b.id),
    ),
    phases: phases.map(({ from }) => ({ from })),
  };
}

export function activeTimelineEvents(events: readonly TimelineEvent[], cursor: number) {
  return events
    .filter(
      ({ start, end }) =>
        start <= cursor && (cursor < end || (start === end && cursor === start)),
    )
    .sort(
      (a, b) =>
        EVENT_KINDS.indexOf(a.kind) - EVENT_KINDS.indexOf(b.kind) ||
        b.start - a.start ||
        a.id.localeCompare(b.id),
    );
}

export function timelineSegments(
  events: readonly TimelineEvent[],
  start: number,
  end: number,
) {
  const intervals = events.filter(
    (event) =>
      event.kind !== "heart" &&
      event.kind !== "glucose" &&
      event.start < end &&
      event.end > start &&
      event.end > event.start,
  );
  const edges = [
    ...new Set([
      start,
      end,
      ...intervals.flatMap((event) => [
        Math.max(start, event.start),
        Math.min(end, event.end),
      ]),
    ]),
  ].sort((a, b) => a - b);
  const segments: { start: number; end: number; event?: TimelineEvent }[] = [];
  for (const [index, time] of edges.slice(0, -1).entries()) {
    const event = activeTimelineEvents(intervals, time)[0];
    const next = edges[index + 1]!;
    const previous = segments.at(-1);
    if (previous && previous.event === event) previous.end = next;
    else segments.push({ start: time, end: next, event });
  }
  return segments;
}

export function snapTimelineSeek(
  instant: number,
  events: readonly TimelineEvent[],
  start: number,
  end: number,
) {
  if (instant <= start || instant >= end - 1) return instant;
  let closest = instant;
  let distance = 4 * 60_000;
  for (const event of events) {
    const candidate = Math.max(start, event.start);
    const delta = Math.abs(candidate - instant);
    if (delta < distance) {
      distance = delta;
      closest = candidate;
    }
  }
  return closest;
}
