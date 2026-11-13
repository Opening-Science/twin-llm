# Two-source synthetic wearables (#508)

Synthetic Oura, WHOOP and Google Health daily summaries for synthetic people, with
the source rules' answer planted in every measure and day. The attribution study
(#508) uses them to check, on data whose truth is known, that the app keeps,
chooses or holds back a wearable reading as [the source rules](../wearable-sources.md)
say. Test data only: no real person, no real reading, never loaded into any database.

Code: `scripts/synthetic-wearables/two-source.ts` and its test.

```sh
bun run wearables:two-source                       # seed 508, 10 people, 30 days ending 2026-10-01
bun run wearables:two-source -- --seed 509 --people 20 --days 60 --end 2026-11-01 --out <dir>
bun run wearables:two-source -- --shares agree=4,no_day=0    # change some shares, keep the rest
```

Output goes to `.synthetic-wearables/two-source-seed<seed>/` (gitignored):

| File                    | What                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `manifest.json`         | Seed, rules version, options, the case shares used and the planted counts                 |
| `people/<person>.json`  | One `OuraSummary`, `WhoopSummary` and `GoogleHealthSummary` (`infrastructure/*-types.ts`) |
| `planted/<person>.json` | The answer key: one label per measure and day, with the decision the rules must make      |

Every file carries `testData: true`, the generator id and `wearable-source-rules/1`;
person ids are `test-<seed>-person-NN`, and every summary's narrative says it is
synthetic test data. Keep `planted/` away from anything that answers questions about
`people/`: it is the key.

## What is planted

Each person has every compared measure (HRV, resting heart rate, blood oxygen, steps)
on every day, and each measure and day gets one case:

| Group                 | Case                                                      | The rules decide                     |
| --------------------- | --------------------------------------------------------- | ------------------------------------ |
| Agree                 | `agree`: two sources within the tolerance                 | `agree`                              |
| Disagree, with winner | `evidence`: beyond the tolerance, published grades differ | `evidence`, the better-graded source |
| No decision           | `no_evidence`: beyond the tolerance, no source graded     | `held_back`, `no_evidence`           |
|                       | `evidence_tie`: beyond the tolerance, grades tied         | `held_back`, `evidence_tie`          |
|                       | `no_dependable_source`: a `poor` grade                    | `held_back`, `no_dependable_source`  |
|                       | `units_differ`: one reading in a unit the rules refuse    | `held_back`, `units_differ`          |
|                       | `no_day`: two readings that carry no day                  | `held_back`, `no_day`                |
| One source missing    | `only_source`: one source recorded it                     | `only_source`, that source           |

The tolerances are read from `SOURCE_TOLERANCE` and the grades from `judgeByEvidence`,
the judge the app uses, so a change to either moves the plants with it rather than
leaving a stale copy. Which cases a measure can carry is worked out by asking the judge
and the rules, pair by pair, and a case they cannot give is never planted. At
`wearable-source-rules/1` and the pinned open-twin:

| Measure                  | agree | evidence | no_evidence | evidence_tie | no_dependable_source | units_differ | no_day | only_source |
| ------------------------ | ----- | -------- | ----------- | ------------ | -------------------- | ------------ | ------ | ----------- |
| `heart-rate-variability` | yes   | yes      | yes         | no           | no                   | yes          | yes    | yes         |
| `resting-heart-rate`     | yes   | no       | yes         | no           | no                   | yes          | yes    | yes         |
| `oxygen-saturation`      | yes   | no       | no          | yes          | no                   | yes          | yes    | yes         |
| `step-count`             | yes   | yes      | no          | no           | no                   | no           | yes    | yes         |

Why the gaps: only Oura has a published grade for HRV and only Google Health for
steps, so those two are the only measures with a winner, and resting heart rate (WHOOP
and Google Health, neither graded) never has one. Blood oxygen is graded `fair` for
every source, so its only disagreement is a tie. Steps have no unit the rules refuse
that still counts steps. The test checks this table against the judge and the rules.

`no_dependable_source` stays at 0 on purpose. The judge gives it only when a source is
graded `poor`, and open-twin's reliability table grades no source `poor` for these
measures. Planting it would mean faking a grade the app does not use, and then the
labels would no longer be what the rules on main decide. It appears once a `poor`
grade enters the table, with no change here.

`no_day` uses keys ending in `unknown` with no `date`, which is how WHOOP stores a
reading it has no day for. The rules pool every dateless reading of a measure into one
decision, so it is planted at most once per person and measure. Oura's HRV is keyed by
its sleep period and never dateless, so HRV's dateless pair is WHOOP and Google Health.
Google Health's summary drops dateless rows, and Oura always has a day, so in live data
only WHOOP writes them; the other sources' dateless readings here test the rules, not
the adapters.

The unit cases use HRV in seconds, heart rate in hertz and oxygen saturation as a
fraction.

Values keep each source's own precision: WHOOP's HRV and SpO2 have one decimal place,
as `features/whoop/summary.ts` rounds them, and everything else is a whole number.
Two readings that are both whole numbers may sit exactly on a tolerance. Where either
has a decimal place, a planted pair sits at least 0.1 inside or outside the bound, and
about a quarter of the agreeing and disagreeing pairs sit as close to it as that allows.
Exactly on the bound, the answer would turn on floating point.

Each day also carries readings the rules never compare (Oura's sleeping heart rate,
WHOOP's recovery score), as a real summary does.

## Shares

The case shares are a config (`DEFAULT_CASE_SHARES`, or `--shares case=weight,...`
over the defaults), and the manifest records the shares used. Each measure divides its
person-days among the cases it can carry in proportion to the weights. Rounding is by
largest remainder, with ties going to the earlier case. A weight of 0 drops a case.
`no_day` is capped at one per person and measure, and what the cap takes goes back to
the other cases.

| Case                   | Default weight |
| ---------------------- | -------------: |
| `agree`                |              3 |
| `evidence`             |              3 |
| `no_evidence`          |              2 |
| `evidence_tie`         |              2 |
| `no_dependable_source` |              2 |
| `units_differ`         |              2 |
| `no_day`               |              1 |
| `only_source`          |              2 |

For seed 508 with the defaults (10 people, 30 days, 1,200 measure-days):

| Case           | HRV | Resting HR | Blood oxygen | Steps | Total |
| -------------- | --: | ---------: | -----------: | ----: | ----: |
| `agree`        |  73 |         97 |           97 |   109 |   376 |
| `evidence`     |  73 |          0 |            0 |   109 |   182 |
| `no_evidence`  |  48 |         65 |            0 |     0 |   113 |
| `evidence_tie` |   0 |          0 |           65 |     0 |    65 |
| `units_differ` |  48 |         64 |           64 |     0 |   176 |
| `no_day`       |  10 |         10 |           10 |    10 |    40 |
| `only_source`  |  48 |         64 |           64 |    72 |   248 |

The seed places the cases among people and days and draws the values. The same seed and
shares write the same bytes.

## Checks

`two-source.test.ts`:

- checks the seed-508 counts and the recorded shares exactly;
- runs `resolveWearableSources` with `judgeByEvidence` from main over the files as
  written, and gets every planted label back (kind, hold reason, source used, sources
  compared);
- checks every measure 0.1 inside and 0.1 outside its tolerance, and that the planted
  pairs keep that margin and reach it;
- checks each source's precision, and that the dateless case is held back once per
  person and measure;
- renders the same seed twice to the same bytes;
- checks the table of possible cases above.

The levels and spreads are plausible ranges chosen for the generator, not fitted to
anyone.
