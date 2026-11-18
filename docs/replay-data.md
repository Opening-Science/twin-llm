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

| Heart rate                    | Evidence                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------- |
| Sleep                         | Recorded sleep before waking.                                                    |
| Waking                        | The half hour after it.                                                          |
| Resting                       | The hour after that, steps recorded and at most 300 per 15 minutes, no activity. |
| Walking, Running              | A walk or run the device recorded.                                               |
| Raised heart rate while still | Above the still threshold, under 50 steps per 15 minutes, no walk or run.        |
| Recovery                      | From a run's end until back within the band, or an hour.                         |
| Winding down and sleep        | From a tag reading exactly "Winding down", or recorded sleep, to the day's end.  |

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

| Rule                               | Basis                 | Gives                                                                                     |
| ---------------------------------- | --------------------- | ----------------------------------------------------------------------------------------- |
| `heart_rate_still_above`           | placeholder threshold | Worth a look: above 100 /min while still.                                                 |
| `heart_rate_activity_not_judged`   | demo only             | Usual: waking, walking, running and winding down are not judged by height.                |
| `heart_rate_near_resting_baseline` | demo only             | Usual within 10 /min of the resting baseline, else Notable; no baseline, Not enough data. |
| `heart_rate_recovery_within_hour`  | demo only             | Usual when back within the band within an hour, else Notable.                             |
| `glucose_past_threshold`           | placeholder threshold | Worth a look past 140 mg/dL (without diabetes) or outside 70–180 (with).                  |
| `glucose_meal_rise`                | demo only             | Notable for a rise of 30 mg/dL or more after a meal, else Usual.                          |

No rule is approved for recorded data yet (`APPROVED_FOR_RECORDED` is empty), so on a
recorded day every status is "Not classified", with that reason. Synthetic
demonstrations show every rule. Without enough data a status is "Not enough data", never
Usual, on any origin, since it judges nothing.
