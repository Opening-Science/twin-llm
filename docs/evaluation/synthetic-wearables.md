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
```

Output goes to `.synthetic-wearables/two-source-seed<seed>/` (gitignored):

| File                    | What                                                                                      |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| `manifest.json`         | Seed, rules version, options and the planted counts                                       |
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
| One source missing    | `only_source`: one source recorded it                     | `only_source`, that source           |

The tolerances are read from `SOURCE_TOLERANCE` and the grades from `judgeByEvidence`,
the judge the app uses, pair by pair, so a change to either moves the plants with it
rather than leaving a stale copy. A case the judge cannot give for a measure is never
planted for it: WHOOP has no steps the rules compare, Oura none of resting heart rate
or blood oxygen, and at the pinned open-twin no pair has a `poor` grade, so
`no_dependable_source` stays at 0. The unit cases use HRV in seconds, heart rate in
hertz and oxygen saturation as a fraction; steps have none.

Each day also carries readings the rules never compare (Oura's sleeping heart rate,
WHOOP's recovery score), as a real summary does.

Counts are fixed by even quotas per measure; the seed places the cases among people and
days and draws the values. For seed 508 with the defaults (1,200 measure-days):

| Case           | HRV | Resting HR | Blood oxygen | Steps | Total |
| -------------- | --: | ---------: | -----------: | ----: | ----: |
| `agree`        |  60 |         75 |           75 |   100 |   310 |
| `evidence`     |  60 |          0 |            0 |   100 |   160 |
| `no_evidence`  |  60 |         75 |            0 |     0 |   135 |
| `evidence_tie` |   0 |          0 |           75 |     0 |    75 |
| `units_differ` |  60 |         75 |           75 |     0 |   210 |
| `only_source`  |  60 |         75 |           75 |   100 |   310 |

## Checks

`two-source.test.ts` checks the seed-508 counts exactly; runs
`resolveWearableSources` with `judgeByEvidence` from main over the files as written
and gets every planted label back (kind, hold reason, source used, sources compared);
and renders the same seed twice to the same bytes. The levels and spreads are
plausible ranges chosen for the generator, not fitted to anyone.
