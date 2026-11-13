# Where a wearable number comes from

When Oura, WHOOP and Google Health record the same measure on the same day, TwinLLM uses
one reading, says which and why, or holds the measure back and says that (#464). The
rules are fixed in code, versioned (`wearable-source-rules/2`) and written to the audit
log with every turn and every read of the summaries, so the attribution study (#508) can
tell which rules produced an answer. Research use only: nothing here says which device is
right about a person.

Code: `infrastructure/wearable-source-rules.ts` (the rules, pure),
`infrastructure/wearable-source-resolve.ts` (applies them to the summaries),
`judgeByEvidence` in `infrastructure/open-twin-adapters/aggregate.ts` (the evidence step)
and `infrastructure/wearable-source-audit.ts` (the audit row).

## What is compared

Only readings that measure the same thing, on the same calendar day. A related measure
from another source is not a disagreement and is never compared.

| Measure                | Stored stems                                                             | Agree within                                          |
| ---------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| Heart rate variability | `sleep.hrv`, `whoop.recovery.hrv`, `google.daily-heart-rate-variability` | The larger of 5 ms and 10% of the highest reading     |
| Resting heart rate     | `whoop.recovery.rhr`, `google.daily-resting-heart-rate`                  | 3 bpm                                                 |
| Blood oxygen           | `whoop.recovery.spo2`, `google.daily-oxygen-saturation`                  | 1 percentage point                                    |
| Steps                  | `activity.steps`, `google.steps`                                         | The larger of 200 steps and 5% of the highest reading |

Oura's overnight HRV and WHOOP's recovery HRV are both RMSSD in ms over the night and
count as one measure. Oura's sleeping heart rate and WHOOP's day average are not, nor
are Oura's sleep score and WHOOP's sleep performance. Oura's naps and rests are left out:
only the main sleep stands for the night. The measure names are open-twin's
(`@open-twin/aggregate`, `Measure`).

Where there are two bounds, the larger applies: 200 steps up to 4,000 steps, then 5%
(600 at 12,000); 5 ms up to 50 ms of HRV, then 10% (8 ms at 80 ms). The line shown to
people says which bound applied ("within 600 steps, the larger of 200 steps and 5% of the
highest reading").

The tolerances are TwinLLM's own display tolerances, chosen so a rounding or a sync
difference does not read as a disagreement. They are not published agreement limits; the
study (#508) may change them, with a new rule set version.

## The rules, in order

For each measure and day where at least one source has a reading:

1. **Only source.** One source has a reading: it is used and named ("From Oura, 15 Oct
   2026"). Nothing else is said.
2. **No day.** Two or more sources have a reading with no day (WHOOP writes `unknown`
   where the day goes): held back, because the app cannot tell they describe the same
   day.
3. **Different units.** A reading in a unit the measure does not take (seconds for HRV,
   say): held back, because the readings cannot be compared. A reading stored without a
   unit is taken to be in the measure's unit. Spellings of one unit count as that unit:
   WHOOP's `bpm` and Google Health's `per minute` are both `/min`, `millisecond` is `ms`
   (rules version 2; version 1 held back every WHOOP and Google Health resting heart rate
   pair for this).
4. **Agree.** The largest and smallest reading differ by no more than the tolerance
   above. One reading is shown and the others are named as agreeing ("WHOOP agrees (WHOOP
   54 ms): within 5.4 ms, the larger of 5 ms and 10% of the highest reading. Oura's
   reading is shown."). Oura, then WHOOP, then Google
   Health picks which agreeing reading is printed; since they agree, that choice says
   nothing about which device is better.
5. **Published evidence.** They disagree. open-twin's validation table (`reliabilityFor`
   in `@open-twin/fhir-core`) grades each source for the measure, and its selection
   policy (`selectSource` in `@open-twin/aggregate`) picks the best-graded source: "Sources
   disagree (WHOOP 61 ms). Oura is used: published validation grades it good for HRV
   (WHOOP no published grade)." The citation for the grade is kept with the decision.
   TwinLLM adds no grade of its own.
6. **Held back.** They disagree and the evidence cannot choose: no source has a published
   grade (`no_evidence`), the grades tie (`evidence_tie`), or a `poor` grade says no source
   is dependable (`no_dependable_source`). No reading is used. The order of the sources
   never breaks a tie.

At the pinned open-twin this gives, for example: HRV, Oura over WHOOP (Oura graded good,
WHOOP not graded); steps, Google Health over Oura; resting heart rate from WHOOP and
Google Health, held back (neither graded); blood oxygen, held back (one grade, fair, for
every source).

## What each place shows

- **Chat.** The prompt lists only the reading used for each measure and day, with its
  rule on the key's line, and asks the answer to name the source and the rule. A
  held-back measure has no key at all, so it can be neither offered nor cited; a block
  "Where the wearable numbers come from" lists it with the reason, without the numbers,
  and asks the answer to say it is held back rather than estimate it. The cited value's
  chip adds the rule under "From Oura, 15 Oct 2026", and the thread export writes it
  after the source. The rule is stored with the answer's attribution as `sourceRule`
  (`{ kind, line }`); answers stored before have none.
- **Digital Twin.** For HRV, resting heart rate, blood oxygen and steps the Vitals row
  shows the newest reading the rules kept, its source, its rule and a status from the UI
  kit (`StatusBadge`): "Sources agree" or "Source chosen on published evidence". When a
  newer day is held back the row's value is "Held back", its status "No source chosen",
  with the reason, and no older number stands in for it. Other vitals (heart rate, sleep,
  strain, breathing rate) are not compared: the first source in the vitals table with data
  is shown and a later source with a related measure is named, as before.
- **What is not resolved.** The Wearables dashboard shows each source on its own and is
  unchanged. The live twin's rates read the resolved summaries, so a held-back day does
  not drive them; their series still come from one source each. The `cross_source_compare`
  query tool reads the snapshots as stored. Synthetic mode reads no wearable snapshot,
  so the rules only run in personal mode.

## The audit row

A chat turn with any wearable summary, and every read of `/api/wearables/summary` (the
chat after an answer, the Digital Twin), writes one row after the summaries are read:

- `tool`: `wearable.sources.` and the sources that had a summary, in a fixed order, for
  example `wearable.sources.oura+whoop`. An audit row keeps its args only as a hash, so
  the sources are in the name, as `personal.read.<purpose>` rows carry their purpose. No
  migration.
- `args` (hashed): the rule set version and, per measure and day, the measure, the
  outcome (`only_source`, `agree`, `evidence`, `held_back`), the source used (none when
  held back), the other sources and the hold reason.
- `result` (hashed): how many decisions had each outcome. `rowCount`: the number of
  decisions.

Never a value, a unit or a day, as for any personal read (#143). A turn refused before
it starts writes none.
