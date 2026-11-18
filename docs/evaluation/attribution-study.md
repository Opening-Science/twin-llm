# Source attribution study harness (P6, #508)

The harness for the study "Which device said so?": local models answer
questions about one synthetic person's wearable readings from several
sources, and the scorer checks whether each stated number's citation names
the reading the number came from. Design and pre-registration live in the
research plan (P6); this page says what the code does. Synthetic data only;
nothing here reads a person's rows or reaches a database.

## Items: W1 and the development set

`bun run attribution:w1` writes item set W1 (`--set dev` the development set)
to `.attribution-study/<set>-seed<seed>/` (gitignored): `items.json` and
`manifest.json`, which records the generator, seed, quotas, the error model
(marked assumed) and the SHA-256 of `items.json`, the hash a registration
records. Code: `scripts/synthetic-wearables/w1-items.ts`.

| Stratum              | W1  | Dev | What is true on the asked day                                      |
| -------------------- | --- | --- | ------------------------------------------------------------------ |
| `single_source`      | 32  | 8   | one source, the only one the person wears                          |
| `agree`              | 64  | 16  | two or three sources within the rules' tolerance                   |
| `disagree`           | 64  | 16  | two or three sources beyond it                                     |
| `day_shift`          | 48  | 12  | one source has the day; another only the days next to it           |
| `missing`            | 32  | 8   | no source has the day; some have the days next to it               |
| `construct_mismatch` | 24  | 6   | probe: Oura Readiness against WHOOP Recovery, two different scores |

Each person has three core items from three strata (80 people in W1, 20 in
the development set, on another seed). Every item asks about resting heart
rate or HRV, the two measures the rules compare that P6 also lists. Each item
holds the asked day and the day before and after, per source.

- **Values.** A latent value per day from a person's level, plus a
  per-source bias and noise (`ERROR_MODEL`, assumed, not from the accuracy
  review). The stratum then sets the asked day's gap against the app's own
  tolerance (`SOURCE_TOLERANCE`): agreeing readings on distinct whole steps
  within half of it each way; disagreeing ones 1.5 to 2.5 times it from the
  first source, a third on the other side.
- **Identifiability.** No two readings of an item are shown as the same
  number (`confusableCells`). The readings of the days next to the asked day
  are moved by whole units until none collides; the asked day's readings,
  which carry the stratum, never move. An item that still fails is drawn
  again, at most 50 times, and the manifest counts the items that needed a
  redraw.
- **Rule.** `fixed_order` (Oura, WHOOP, Google Health: state the first that
  has the day and name the others) or `hold_back` (withhold when the
  sources disagree beyond the tolerance, else as fixed order). Half of each
  stratum gets each rule, by a seeded shuffle.
- **Listing order.** The order the prompt lists the sources in is a seeded
  permutation drawn apart from the rule.
- **Expected answer.** `state` (the reading, its source and day, the other
  sources), `withhold`, `abstain` or, for a probe, `distinguish`.

## Conditions

`scripts/evaluation/attribution-study/contexts.ts` writes the prompt. Its
headings and Evidence Used rules are the chat's, so `parseTwinAnswer` reads
the answer as the app would.

| Id  | Each reading in the prompt                                                             |
| --- | -------------------------------------------------------------------------------------- |
| C0  | `[key] label: value`, as before #464                                                   |
| C1  | C0 plus `(source: WHOOP; day: 2 Jan 2026)`, and the selection rule in words            |
| C2  | C1 plus one accuracy note per source from `features/wearables/accuracy` with its level |

Google Health's note says the device behind a reading is not known and gives
both the Fitbit and the Pixel Watch note, at the lower evidence level.

## Counterfactual reruns

`counterfactual.ts`, under C1 on agree and disagree items:
`perturb_cited` moves the expected reading by one display unit (two if one
breaks the stratum or identifiability), `perturb_other` moves another
source's reading of that day, and `rule_swap` sets `fixed_order` in the
reversed order (Google Health, WHOOP, Oura), so the source the rule picks
changes on every item and a held-back value must be stated. A swap that
would ask for the same answer is not run.

## Scoring

`score.ts` scores one answer against its item. Every number in the Answer
section is traced to the reading whose value it is (`traceStated`); a number
in the measure's unit that no reading holds is `untraced`. A traced number is
`correct` when its reading is cited, else the verdict of the nearest cited
reading of its measure that no other number is the value of (`wrong_source`,
`wrong_day`, `wrong_source_and_day`), else `uncited`.

| Outcome                    | Over                     | True when                                                                                                           |
| -------------------------- | ------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| Attribution correct (H1)   | items expecting a number | at least one wearable number, every one `correct`                                                                   |
| Disagreement handled (H2a) | disagree                 | fixed order: expected reading stated, others named, order given; hold back: no asked-day number, every source named |
| Over-hedged (H2b)          | agree                    | says the sources disagree, holds back or averages, or states no asked-day number                                    |
| Day correct                | day shift                | the asked day's reading stated and cited, every number `correct`                                                    |
| Abstention correct         | missing                  | says there is no reading, and every number it states is cited to its own day                                        |
| Construct mismatch handled | probes                   | says the scores are different and does not average them                                                             |

The phrase lists (`HEDGE`, `RULE_REASON`, `NO_READING`, `DIFFERENT_SCORES`)
are heuristics; P6 validates them with a second rater.

## User study stimuli (Part B)

`bun run attribution:stimuli` writes the user study's stimuli to
`.attribution-study/stimuli-seed<seed>/` (seed 6510 by default):
`stimuli.json` and one static preview page per arm, `D0.html`, `D1.html`
and `D2.html`. The pages have no script and make no request; they are for
reading the wording and the display per arm before the stimuli go to the
ethics committee and the survey platform. Code: `stimuli.ts`,
`stimulus-page.ts`.

- **Persona.** "Alex", 21 synthetic nights of resting heart rate (WHOOP,
  Google Health) and HRV (Oura, WHOOP, Google Health), from a latent value
  plus W1's assumed error model. Google Health records every night, the
  others miss about one in three. The data panel lists every reading.
- **Detection trials (16).** The chip claims the source the fixed order shows
  that night, as the app's chip does, so its rule line is true. The answer
  states that source's reading (8, `correct`), another source's reading of
  that night (4, `wrong_source`), or the claimed source's reading of the
  night before or after (4, `wrong_day`); balanced over the two measures.
  All are constructed and say so.
- **Calibration trials (6).** Correct answers: three on a source and measure
  the accuracy review validated, three on one it found no evidence for. W1's
  measures have no "limited" pair.
- **Arms.** D0 the answer alone; D1 adds the chip and, when other sources had
  a reading, the rule line; D2 adds the accuracy note and its level. The
  answer text is the same in every arm.
- A stated number is never shown as the same number as another reading a
  participant checks it against (every source's that night, the claimed
  source's on the nights next to it). A persona that cannot fill every trial
  is drawn again, at most 50 times; `attempt` records which draw was used.

## Running

`bun run attribution:study -- --items <items.json> --model <model>` runs
every item under C0, C1 and C2 (`--conditions`), `--repeats` times, with
`--counterfactual` for the reruns. A model is `fake:first_listed` (states
the first listed reading for the day and cites it), `fake:cite_other`
(states it, cites another source's reading), or `ollama:<tag>` on this
machine, called as the chat calls it (no thinking pass, the app's context length, the model's default sampling; `--temperature 0` for the sensitivity pass, named in the model id). A failed call is tried three times, then recorded as an error and
counted as a failure (on the agree stratum, as over-hedged). Each call
sends a seed hashed from model, item, condition and repeat (`callSeed`), so
a rerun of a cell asks Ollama for the same draw, and redirects are refused.
Each answer is a line of `records.jsonl` with its full prompt, seed, answer
and score; `report.md` gives every outcome per condition with

counted as a failure. Each answer is a line of `records.jsonl` with its full
prompt, answer and score; `report.md` gives every outcome per condition with
the Wilson 95% interval, citation precision and recall, the verdict counts,
and the counterfactual tests. Each pairs a C1 answer with its variant (same
model, item and repeat): the rule swap over citation-correct answers (H3),
the value tests over answers that stated the expected reading, cited.
Attribution correct is counted over items whose right answer states a
number. `--report <records.jsonl>` rewrites the report only.

The fakes are for tests and dry runs. No model run of W1 is reported until
the registration is filed.

## Registered contrasts

`analysis.ts` computes the pre-registered contrasts that need no model
fitting, and the report ends with them. All models are pooled.

| Hypothesis | Contrast                                                         | Decision                                                 |
| ---------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| H1         | attribution correct, C1 − C0, items whose answer states a number | Holm over {H1, H2a, H3} at 0.05, effect positive         |
| H2a        | disagreement handled, C2 − C1, disagree stratum                  | as H1                                                    |
| H2b        | over-hedging, C2 − C1, agree stratum                             | non-inferior when the upper 95% bound is below 10 points |
| H3         | rule-swap failure share among citation-correct C1 answers        | one-sided 95% lower bound above 5%, Holm as H1           |

Intervals are percentiles of a cluster bootstrap over synthetic persons
(2,000 resamples, seed 6508). The bootstrap p-value is twice the smaller
share of draws on either side of zero (for H3, the share of draws at or
below 5%). This is the registered fallback for H1 and H2a; the
mixed-effects models run on the same records outside this harness.

H2b is evaluated only when H2a is supported, as the registration orders it;
otherwise its row says so. A harness error counts as a failure, which for
over-hedging means it counts as over-hedged.

### Where this differs from the registration draft

These need settling in the pre-registration before it is filed:

- **H1's denominator.** The draft defines attribution correct as "at least
  one wearable number, and every one correctly cited", over all answers.
  On a missing item, or a held-back disagree item, a right answer states no
  number and would always fail. The harness counts H1 only over items whose
  right answer states a number: 176 of W1's 240 core items, not 240. The
  draft's power rationale needs about 206 items, so H1 as computed here is
  below the registered power.
- **H3's p-value.** The draft decides H3 by a one-sided 95% lower bound
  against 5% and puts H3 in a Holm family, but defines no p-value for it.
  The harness uses the share of bootstrap draws at or below 5%. Under Holm
  that p may be judged at 0.0167 or 0.025, while the bound in the table is
  still the 95% one, so the two can disagree near the margin.
- **The tests.** H1 and H2a are registered as mixed-effects models with the
  bootstrap as the fallback; only the fallback is here.

For Part B, `detection` gives d′ and criterion c with the log-linear
correction (0.5 added to hit and false-alarm counts, 1 to trial counts), and
`welch` gives Welch's t-test with its two-sided p.

## Second rater

`bun run attribution:rater -- --records <records.jsonl> --items <items.json>`
draws a stratified sample of base answers (150 by default, in proportion to
the strata, at least one each, seeded) and writes `sheet.csv` and `rubric.md` (what `y` means per outcome) for the rater
and `key.json` to keep apart. The procedure is the one in
[second-rater.md](second-rater.md); only the sheet and the rubric differ.

A row shows the question, every reading the model was given with its
source and day, the selection rule, the keys the answer cited, the Answer
section, and which outcomes to code. It shows no model, condition, item id,
expected answer or automatic score; the rule is on every row, so C0 rows do
not stand out. Each row has an opaque `sheet_id` (HMAC-SHA256 under a salt
kept in the key). The rater writes `y` or `n` per outcome, or leaves it
blank.

`--agreement --sheet <filled.csv> --key <key.json> --records <records.jsonl>`
writes `agreement.md`: per outcome, the rows coded, the scorer's share of
`y` (prevalence), observed agreement and Cohen's kappa with its 95%
interval (`cohenKappa`, as the harness's own agreement uses).
