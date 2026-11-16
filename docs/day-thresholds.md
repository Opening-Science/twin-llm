# Day thresholds and wording, for review

For Robin. Every number that decides what `show_my_day` marks, and every sentence it
puts on screen. All thresholds are **placeholders** until Robin confirms or replaces
them. Nothing here is clinical guidance; a marked window is "worth a look", never a
judgement about a person.

Code: `packages/query-tools/day-beats.ts` (rules and wording),
`packages/query-tools/day-thresholds.json` (the thresholds Robin owns),
`packages/query-tools/day-beat.ts` (how a value is written). The test
`packages/query-tools/day-thresholds-doc.test.ts` fails when a threshold or a sentence
changes in code and not here.

## Thresholds Robin owns (`day-thresholds.json`)

Status `placeholder`, reviewer Robin.

| Key                               | Value        | What it marks                                                                                                       |
| --------------------------------- | ------------ | ------------------------------------------------------------------------------------------------------------------- |
| `heartRateStillAbovePerMin`       | 100 /min     | Heart rate above this while the person is still. Readings while moving, or with activity unknown, are never marked. |
| `glucoseWithoutDiabetesAboveMgDl` | 140 mg/dL    | Profile `without_diabetes`: blood glucose above this.                                                               |
| `glucoseWithDiabetesRangeMgDl`    | 70–180 mg/dL | Profile `with_diabetes`: blood glucose below 70 or above 180 (the usual consensus target range).                    |

Consecutive readings past a threshold form one window. The window's beat carries the
highest value (or, below the range, the lowest).

## Rules in code (not yet in the JSON)

These shape which signal a beat is about and when insulin is described. They are not
red-window thresholds, but Robin may want to change them too.

| Rule               | Value                                                     | Effect                                                                                                                |
| ------------------ | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Weight of a change | 20 /min of heart rate = 15 mg/dL of glucose               | Each reading's beat is about the signal that moved more on this scale; a tie or the first reading goes to heart rate. |
| Steady heart rate  | change under 5 /min                                       | Direction "steady".                                                                                                   |
| Steady glucose     | change under 10 mg/dL                                     | Direction "steady".                                                                                                   |
| Insulin described  | glucose rise of 20 mg/dL or more since the reading before | Adds a narrated insulin beat. Insulin is never measured, so it never shows a number.                                  |

## Wording on screen

Body sentences, one per beat:

| Beat               | Sentence                                                                                                                                |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------- |
| Heart rate up      | The heart beats faster to move more blood to working muscles.                                                                           |
| Heart rate down    | The heart slows as the body settles.                                                                                                    |
| Heart rate steady  | The heart keeps a steady pace.                                                                                                          |
| Glucose up         | Sugar from food passes into the blood.                                                                                                  |
| Glucose down       | Muscle and liver take sugar out of the blood.                                                                                           |
| Glucose steady     | Blood sugar holds near its usual level.                                                                                                 |
| Insulin (narrated) | The pancreas releases insulin, which helps cells take up sugar. Insulin is not measured here; this beat describes what usually happens. |

Window labels and rules (the event reads `Red window`):

| Window                    | Sentence                                                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Heart rate                | The heart beats fast while the body is still. Heart rate above 100 /min while still (placeholder).                                 |
| Glucose, without diabetes | Blood sugar stays past the threshold for a while. Blood glucose above 140 mg/dL (placeholder, without diabetes).                   |
| Glucose, with diabetes    | Blood sugar stays past the threshold for a while. Blood glucose outside 70–180 mg/dL (placeholder consensus range, with diabetes). |

How a value line reads (`signalText`):

- Measured or derived: `Blood glucose up · about 135 mg/dL · measured`
- Narrated: `Insulin up · narrated, not measured`

A reading with no recorded event shows the event `Reading`.

## Questions for Robin

1. Are 100 /min (still), 140 mg/dL and 70–180 mg/dL the right first thresholds?
2. Should a heart-rate window need a minimum length (say two readings) before it is
   marked?
3. Should the rules in code (weights, steady bands, the 20 mg/dL insulin rise) move
   into the JSON so you own them too?
