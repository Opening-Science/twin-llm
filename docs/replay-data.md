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
| `notice`                           | Always set on a synthetic day: a made-up person and day, not advice.      |
| `readings`, `events`, `narrations` | The items below. Each one repeats the person, day, zone and origin.       |

The parser refuses an item of another person, day, zone or origin, so a screen that
switches person or date cannot show the previous selection's values. Compare
selections with `replayKeyOf` or `belongsTo`, never by `subject_ref` alone.

The day is local, not UTC: it runs from local midnight to the next one, so a
daylight-saving day has 23 or 25 hours (`localDayBounds` in `local-time.ts`). Instants
are stored in UTC. Show a time with `localClock`, which gives the local `HH:MM` and the
offset: on the autumn change, 02:30 happens twice.

## Items

| Item      | Holds                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Reading   | `heart_rate` in /min, `glucose` in mg/dL with its specimen (blood or sensor), `steps`, or a device's nightly `resting_heart_rate` (/min) and `hrv_rmssd` (ms); an instant; `interval_min`. |
| Event     | `sleep` or `activity` (walk, run) from a device; `meal` (breakfast, lunch, snack, dinner) or `tag` the person entered.                                                                     |
| Narration | What usually happens in a body, about heart rate, glucose, insulin or the body, with a focus on the twin.                                                                                  |

A reading is `available` with a value, or `missing` with `value: null` and a reason (a
sensor warming up, a ring off the finger). A missing value is never filled in; the gap
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
|                      | 28 Oct                        | No glucose sensor worn and no activity recorded.                                                                                                       |
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
adding nothing. A tag the person entered becomes an entered event, and a meal only when
it plainly names one ("Large dinner", not "Walk after lunch"); no new logging is needed.
`moving` does not become an activity, since it does not say walk or run.
