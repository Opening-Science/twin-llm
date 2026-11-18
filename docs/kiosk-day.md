# Kiosk day: the response open-twin-xr reads

For Berk. The shape of one day the kiosk plays on the twin, version
`twin-llm.kiosk-day.v1`. It is a flat, display-ready form of a `show_my_day` result
([query-layer.md](query-layer.md)): every line to show is already written, and every
beat says where the twin turns. The kiosk draws; it never computes a value, a window or
a sentence.

Source of truth: the zod schema `kioskDaySchema` in
`packages/query-tools/kiosk-day.ts`, built by `toKioskDay`. Examples, the illustrative
mock day: with blood glucose, [kiosk-day.example.json](kiosk-day.example.json), and as a
monitor wearer's day with sensor glucose only,
[kiosk-day.sensor.example.json](kiosk-day.sensor.example.json). A test fails when an
example and the code drift apart.

How the kiosk gets the response (an MCP call, an HTTP route, or a file for the demo) is
not decided yet; the shape is the same whichever it is.

## Top level

| Field            | Type                                  | Meaning                                                                                                              |
| ---------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `schema_version` | `"twin-llm.kiosk-day.v1"`             | Changes only when a field changes meaning or goes away. A new version is a new name. `specimen` was added within v1. |
| `notice`         | string                                | Shown with the day, always: synthetic person, not a recording, not advice.                                           |
| `subject_ref`    | string                                | The synthetic subject. Never a real person.                                                                          |
| `day`            | `YYYY-MM-DD`                          | The day played.                                                                                                      |
| `profile`        | `without_diabetes` \| `with_diabetes` | Which glucose thresholds the windows use.                                                                            |
| `beats`          | array of beats, in time order         | What the twin plays, one after another.                                                                              |
| `worth_a_look`   | array of windows, in time order       | Stretches past a threshold, for a timeline band.                                                                     |
| `thresholds`     | `{ status: "placeholder", reviewer }` | The thresholds are placeholders until the reviewer confirms them; say so.                                            |
| `activity`       | `recorded` \| `not recorded`          | `not recorded` for a warehouse day: no events, so beats read "Reading".                                              |
| `timezone`       | `"UTC"`                               | Beat and window times are wall-clock times in this zone.                                                             |

## A beat

| Field          | Type                                   | Meaning                                                                                                                   |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `time`         | `HH:MM`                                | When.                                                                                                                     |
| `event`        | string                                 | What the person was doing, "Reading", or "Worth a look" on a window's beat.                                               |
| `source`       | `measured` \| `derived` \| `narrated`  | Where the value comes from. Show it.                                                                                      |
| `measure`      | `heart_rate` \| `glucose` \| `insulin` | Which signal.                                                                                                             |
| `specimen`     | `blood` \| `sensor` or null            | On a glucose value: a blood reading, or a continuous sensor's, which trails the blood by several minutes. Null otherwise. |
| `direction`    | `up` \| `down` \| `steady`             | Since that measure's last reading.                                                                                        |
| `value`        | number or null                         | Null exactly when `source` is `narrated`. Never invent one.                                                               |
| `unit`         | `/min` \| `mg/dL` or null              | Null with `value`.                                                                                                        |
| `line`         | string                                 | The value line to show, as written: "Blood glucose up · about 135 mg/dL · measured".                                      |
| `body`         | `{ text, organ }`                      | The sentence on what happens in the body, and the organ it is about.                                                      |
| `view`         | `{ focus, depth }`                     | Where the twin turns: a focus id of `packages/anatomy/twin-focus.ts`, at `scan`, `muscle`, `skeleton` or `organs`.        |
| `worth_a_look` | boolean                                | True only on a window's derived beat.                                                                                     |

The schema refuses a narrated beat with a value, insulin in any form but narrated,
`worth_a_look` on a beat that is not derived, a glucose value without its specimen, and
a specimen on anything else. Insulin is never measured: no wearable reads it.

## A window

`{ from, to, measure, specimen, extreme, unit, rule }`: consecutive readings past a
threshold, `specimen` blood or sensor on a glucose window and null on heart rate,
`extreme` the highest (or, below a range, the lowest) value, `rule` the sentence naming
the threshold. Thresholds and every sentence are listed for review in
[day-thresholds.md](day-thresholds.md).

## Rules for the screen

- Show `notice` with the day, and "placeholder" while `thresholds.status` says so.
- Show `line` and `body.text` as given; never shorten a number or add a judgement.
- A narrated beat shows no number, by design.
- Blood and sensor glucose are different measures. Show which one a value is (the
  `line` already says it), and never draw them as one series or compare one with the
  other: a sensor window can open at another time than a blood window, or not at all.
- "Worth a look" marks a moment to look at, never a verdict on the person.
