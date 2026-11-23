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
