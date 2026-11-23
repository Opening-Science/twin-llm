# Replay data: the shared layer under the day replay

For Berk, and anyone building on #860. The day replay, its charts and cards, the 3D
animation and the ten-night view all read one typed data layer in
`packages/query-tools/replay/`. It decides what a value is and where it comes from, so
no screen has to. It sits beside `show_my_day` and the kiosk day
([kiosk-day.md](kiosk-day.md)) and changes neither.

Everything here is pure and free of I/O. Synthetic demonstrations only; no new device
integration.

## A replay day

`replayDaySchema` in `replay-day.ts`: one person's local day.

| Field                              | Meaning                                                                   |
| ---------------------------------- | ------------------------------------------------------------------------- |
| `subject_ref`, `day`, `time_zone`  | The person, the local calendar day (`YYYY-MM-DD`) and its IANA time zone. |
| `origin`                           | `recorded` or `synthetic_demo`. A day is one or the other, never both.    |
| `notice`                           | `DEMO_NOTICE` on a synthetic day, word for word; null on a recording.     |
| `readings`, `events`, `narrations` | The items below. Each one repeats the person, day, zone and origin.       |

The parser refuses an item of another person, day, zone or origin, so a screen that
switches person or date cannot show the previous selection's values. Compare
selections with `replayKeyOf` or `belongsTo`, never by `subject_ref` alone.

The day is local, not UTC: it runs from local midnight to the next one, so a
daylight-saving day has 23 or 25 hours (`localDayBounds` in `local-time.ts`). Instants
are stored in UTC. Show a time with `localClock`, which gives the local `HH:MM` and the
offset: on the autumn change, 02:30 happens twice. An event or narration belongs to the
day when it overlaps it: one that ends exactly at the day's first midnight belongs to the
day before.

## Items

| Item      | Holds                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reading   | `heart_rate` in /min, `glucose` in mg/dL with its specimen (blood or sensor), `steps`, or a device's nightly `resting_heart_rate` (/min) and `hrv_rmssd` (ms); an instant; `interval_min`. |
| Event     | `sleep` or `activity` (walk, run) from a device; `meal` (breakfast, lunch, snack, dinner) or `tag` the person entered, and only entered.                                                   |
| Narration | What usually happens in a body, about heart rate, glucose, insulin or the body, with a focus on the twin.                                                                                  |

A reading is `available` with a value, or `missing` with `value: null` and a reason from
`MISSING_REASONS` (a sensor warming up, a ring off the finger). The reason is shown as it
is, so it is one of these short lines, never a provider's error text. A missing value is never filled in; the gap
stays a gap. `interval_min` is how much time one reading stands for, which decides what
can be computed from it (no one-minute recovery from 15-minute samples).

## Provenance

Every item says how we know it, and the parsers enforce what each allows:

| Provenance | Means                                      | Source names | Value          |
| ---------- | ------------------------------------------ | ------------ | -------------- |
| Measured   | A device recorded it.                      | the device   | yes            |
| Entered    | The person entered it, such as a meal tag. | the person   | yes, or none   |
| Derived    | Computed here from other items.            | TwinLLM      | yes, with rule |
| Narrated   | What usually happens in a body.            | TwinLLM      | never          |

A derived item names its `rule` (an id and a sentence) and the `evidence` ids it used;
nothing else may. Narration has no value field and no digit in its text, so it cannot
carry a hormone amount. Insulin is narrated only: no reading stream holds it.

A synthetic demonstration keeps these four labels, so it can show what a measured value
looks like, but `origin` and the day's `notice` say on every item that it is made up.

## Demo days

`demo-days.ts` builds deterministic synthetic days; no randomness, so the same call gives
the same day. `demoReplayDay(subject, day)` returns null for a person or day the demo
does not have, never a stand-in.

| Person               | Days                          | Shows                                                                                                                                                  |
| -------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `synthetic-replay-a` | 20–29 Oct 2026, Europe/Berlin | Ten distinct nights. 25 Oct is the autumn clock change (25 hours, 100 quarter-hours). One night elevated alone (24th), then two in a row (26th, 27th). |
|                      | 27 Oct, the reference day     | Evidence for all sixteen phases of #860; sensor glucose missing 10:00–10:45; a blood value the person entered; heart rate every minute 18:30–19:14.    |
|                      | 22 Oct                        | Nothing recorded.                                                                                                                                      |
|                      | 23 Oct                        | The ring stops syncing at 20:00: later heart rate is stale.                                                                                            |
|                      | 28 Oct                        | No glucose sensor worn, no steps or activity recorded: heart rate, nightly values, sleep and tags only.                                                |
|                      | 29 Sep–19 Oct                 | Nightly values only: history for a personal baseline.                                                                                                  |
| `synthetic-replay-b` | 26–29 Oct 2026                | No history: no baseline can be formed.                                                                                                                 |

Heart rate, steps and sensor glucose come every 15 minutes; meals and "Winding down" are
tags the demo person entered.

## A value at a time, and the gaps

`at-time.ts` answers what a card or the 3D view shows at the cursor. `readingAt(day,
series, cursor)` gives one of:

| State         | Means                                                                                                                       |
| ------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `available`   | The last reading at or before the cursor, with its age in minutes.                                                          |
| `stale`       | That reading is older than 30 minutes or twice the time it stands for, whichever is longer. Show it as stale, with its age. |
| `unavailable` | No value, and `text` says why: missing (with the source's reason), not yet, not recorded that day, or not on this day.      |

A missing sample is never bridged with the value before it. Blood and sensor glucose are
asked for separately. `chartSeries` gives the runs of values to draw as lines and the
gaps between them (missing, or no readings), so a chart never joins across a gap.

## Shared playback transport

Mount [`ReplayProvider`](../features/digital-twin/replay/replay-provider.tsx) around the
Your Day replay surfaces, and unmount it when leaving Your Day. Pass the selected
`ReplayKey` (person, local date, time zone), including for missing or partial days.
The selection is independent of loading state: changing it replaces the clock at
local midnight, paused, and cancels the old clock before paint. Pass optional keyed
`story: { selection, phases }` from `storyPhases`; late phases for the current day
do not reset the cursor, and phases for another selection do not schedule holds.
Keep loading, stream availability and rendering errors in the consuming surfaces.

Read `useReplaySnapshot()` for the shared cursor (`cursorMs`, UTC epoch milliseconds),
local-day bounds, playback status, speed and hold state. Use this same cursor for
clock labels, recorded events, `readingAt`, charts and anatomy targets. The end
bound is exclusive; the terminal cursor stays in the selected day. The separate
`useReplayActions()` hook exposes play, pause, replay from midnight, set speed,
seek to an instant, and step 15 elapsed minutes in either direction. Event jumps
use seek, which publishes immediately without starting or stopping playback and
discards the current hold. Scrubber snapping, keyboard bindings and date navigation
belong to the controls or shell, not the transport.

Default replay budgets five minutes for the reference fixture, including a
three-second hold per distinct story start reached during playback. Fast demo
uses 45 seconds without holds. Speed only affects the historical cursor: the
anatomy should use the reading at that cursor, not the playback rate.

## The days `show_my_day` already reads

`replayDayFromDayReadings` turns the readings `show_my_day` builds into a replay day,
adding nothing. A tag becomes an event, and a meal only when it plainly names one
("Large dinner", not "Walk after lunch" or "Skipped breakfast"); no new logging is
needed. The only tags that arrive today are the mock day's story lines (the warehouse
sets none), so their source reads "Written for the illustrative day's story, not entered
by anyone". `moving` does not become an activity, since it does not say walk or run.

Every such day is a synthetic demonstration with the demo notice. `show_my_day` reads
synthetic people only, so none of their days is labelled `recorded`; that origin waits
for real recordings.

## Enough data first

A personal baseline (`baseline.ts`) is the median of the device's nightly value over the
28 days before the day, the day itself left out, from at least 7 nights (the floor the
wearable trends use). With fewer, the result is `insufficient` with the count and what is
needed, and there is no band. Only the same person's nights of the same origin count.

Recovery after a run (`recovery.ts`) is only as precise as the readings. The one-minute
drop needs a reading at the run's end and the next at most a minute later; from
15-minute readings the result says the readings are too coarse. "Back within the band"
(`recoveryWithinPerMin`, a placeholder) is an upper bound and carries the spacing it
was read at.

## Story phases

`storyPhases(day, { restingBaseline })` in `phases.ts` gives the stretches of heart
rate and glucose the evidence supports. A phase needs its evidence (a recorded sleep,
walk or run, a tag the person entered) and readings of its own stream inside it; between
phases nothing is said, and a day without that evidence has fewer phases.
`phaseGaps(day)` says why, per stream: no heart rate, no glucose (sensor or blood), no
steps, no sleep or no walk or run recorded, each with the phases it rules out, so a card
shows that state instead of guessing.

| Heart rate                    | Evidence                                                                                           |
| ----------------------------- | -------------------------------------------------------------------------------------------------- |
| Sleep                         | Recorded sleep before waking.                                                                      |
| Waking                        | The half hour after it.                                                                            |
| Resting                       | The hour after that, steps recorded and at most 300 per 15 minutes, no activity.                   |
| Walking, Running              | A walk or run the device recorded.                                                                 |
| Raised heart rate while still | Above the still threshold, under 50 steps per 15 minutes, no walk or run in it or the hour before. |
| Recovery                      | From a run's end until back within the band, or an hour.                                           |
| Winding down and sleep        | From a tag reading exactly "Winding down", or recorded sleep, to the day's end.                    |

| Glucose                  | Evidence                                                                     |
| ------------------------ | ---------------------------------------------------------------------------- |
| Overnight fasting        | Sleep before waking with no meal, up to the night's lowest glucose.          |
| Before waking (dawn)     | From that low to waking, a rise of 10 mg/dL or more with no meal.            |
| Breakfast, Snack, Dinner | 90 minutes after the person's meal tag, or until the next meal.              |
| Lunch and a walk         | A lunch tag with a recorded walk starting within the hour (otherwise Lunch). |
| Running                  | A recorded run.                                                              |
| Back to sleep            | From recorded evening sleep to the day's end.                                |

Glucose phases read the sensor series when there is one, else blood. Each phase is
derived and carries its rule, its evidence ids, a peak or low (derived, with the reading
it came from, never the value at the cursor) and, where it helps, a narration. Insulin is
narrated after a meal; the raised heart rate while still is narrated without a cause.

## Usual, Notable, Worth a look

Each phase carries a `status` with its words, its rule (`id`, `text`, `basis`), its
evidence and a one-sentence reason (`status-rules.ts`).

| Rule                               | Basis                 | Gives                                                                                                                         |
| ---------------------------------- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `heart_rate_still_above`           | placeholder threshold | Worth a look: above 100 /min while still.                                                                                     |
| `heart_rate_activity_not_judged`   | demo only             | Usual: waking, walking, running and winding down are not judged by height.                                                    |
| `heart_rate_near_resting_baseline` | demo only             | Usual within 10 /min of the resting baseline, else Notable; no baseline, Not enough data.                                     |
| `heart_rate_recovery_within_hour`  | demo only             | Usual when back within the band within an hour, else Notable; Not enough data when heart rate was not read through that hour. |
| `glucose_past_threshold`           | placeholder threshold | Worth a look past 140 mg/dL (without diabetes) or outside 70–180 (with).                                                      |
| `glucose_meal_rise`                | demo only             | Notable for a rise of 30 mg/dL or more after a meal, else Usual.                                                              |

No rule is approved for recorded data yet (`APPROVED_FOR_RECORDED` is empty), so on a
recorded day every status is "Not classified", with that reason. Synthetic
demonstrations show every rule. Without enough data a status is "Not enough data", never
Usual, on any origin, since it judges nothing.

## Heart-rate zones

`zoneMinutes(day, person)` in `zones.ts` gives the minutes a day spent in each of four
zones, from heart rate as a share of an age-based maximum. The result is derived, with
its rule and the readings it used.

The maximum is an estimate, not measured: 208 − 0.7 × age (Tanaka, Monahan and Seals,
_J Am Coll Cardiol_ 2001;37:153–156). A person's real maximum can differ from it by a
wide margin. The bands are the ACSM position stand's shares of maximum heart rate
(Garber et al., _Med Sci Sports Exerc_ 2011;43:1334–1359, table 4), kept in
`HEART_RATE_ZONES`:

| Zone         | Share of the estimated maximum | ACSM name    |
| ------------ | ------------------------------ | ------------ |
| Light        | 57–63%                         | Light        |
| Moderate     | 64–76%                         | Moderate     |
| Intense      | 77–95%                         | Vigorous     |
| Very intense | 96% or more                    | Near-maximal |

Below 57% is no zone. Each heart-rate reading counts for the time it stands for, cut
short at the next reading and the day's end, so 15-minute and one-minute samples never
count a minute twice. A missing reading, or none, counts as no zone at all, and
`heart_rate_min` says how much of the day had a heart rate.

Age comes from the person's record (`demoPerson`: person A is 34, person B has no age).
Without an age the result is "unavailable: no age"; nothing is guessed. On the reference
day person A's run is intense.

## Ten nights

`nightSummaries(history, person, dates)` in `nights.ts` gives one summary per date, in
order, from that person's days of that origin only. A date the history does not hold is
"nothing recorded" and shows no value; it never borrows a neighbour's. Every summary
carries `notice`: `DEMO_NOTICE` on a demonstration, a date with no data included, and
null on a recording.

| Field                                           | Provenance | Notes                                                                                          |
| ----------------------------------------------- | ---------- | ---------------------------------------------------------------------------------------------- |
| `resting_heart_rate`, `hrv`                     | measured   | The device's nightly values, with source and time.                                             |
| `baselines`, `bands`                            | derived    | Band: median ± 1.4826 × MAD of the 28 nights before. Unavailable without 7 nights.             |
| `resting_delta`                                 | derived    | This night less the baseline median; unavailable without a baseline.                           |
| `steps`                                         | derived    | The sum of the steps recorded, and whether they cover at least 90% of the day.                 |
| `activity_minutes`                              | derived    | Minutes of each recorded walk and run; unavailable when no activity is recorded at all.        |
| `peak_heart_rate`, `lowest_night_heart_rate`    | derived    | With the reading they came from. `night` is the sleep before waking, for the strip.            |
| `availability`, `availability_text`, `coverage` | derived    | Complete, partial or none, said in words; coverage per stream over the day's quarter-hours.    |
| `status`, `sentence`                            | derived    | Under `resting_heart_rate_elevated_nights` (demo only); the sentence states numbers, no cause. |

A night 5 /min or more above the resting baseline is raised: alone it is Notable, the
second in a row or later Worth a look, otherwise Usual. Without a baseline it is Not
enough data. On the demo, 24 October is raised alone and 26–27 October in a row; person B
has no baseline on any night. Every evidence id names its day (`2026-10-27/night-resting-hr`),
the night's own reading as well as the baseline's, so ten nights never share one id.
