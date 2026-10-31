# Second rater

Written 2026-10-31 (#351). A second, blind rating of the answers to the
heart-brain (hb) questions, next to the automatic scorer, for P3. It reads
evaluation runs of the hb set on this machine (synthetic cohort
`synthea-v4-1m-af` only), saves ratings in a file beside each run, and
reports agreement as Cohen's kappa. Research use only; nothing here is about
a person.

## Why

`docs/research/heart-brain-timing-2026-10.md`, Part 5, reads the Brain agent's
verdicts as 26 of 27 "by reading", which is one person's reading and not
blind. The exact verdict check finds 11, and the correctness scorer 24 of 26.
A second rating that sees neither the model nor the score says how far a
reader and the scorer agree, and how far two readers do.

## Using it

1. Make hb runs: `bun run eval -- --models agent:brain --set hb --scenario S7`
   (and the other models). They land in `evaluation/runs/<run-id>/`
   (gitignored).
2. Start the app on a local install (`LOCAL_MVP=true` or
   `AUTH_DISABLED=true`) and open Lab, "Second rating", or `/lab/rate`.
3. Enter a pseudonym such as `rater-b`, not your name. It names your ratings
   file. The first time, the server starts your rating set: it makes a
   random salt that fixes your answer ids and the order of the answers
   (see Blinding).
4. Rate each answer with the stars, read the anchor of the level you chose,
   add a comment if it helps, and press Save and next.
5. Stop at any time. Opening `/lab/rate?rater=rater-b` again resumes at the
   first answer without a rating; earlier ratings are shown and can be
   changed or cleared.
6. When every answer is rated, Export ratings downloads all your files as one
   JSON document.
7. `bun run eval:agreement -- <run-id> [<run-id> …]` prints the agreement;
   add `--ids` to also map each rater's answer ids back to their runs.

## What the rater sees

One answer at a time: the question, the reference (the answer key's values
for that item: the verdict, the numbers, or the tool's refusal code), the
item's note on what a good answer does, and the whole reply as the model
wrote it. The answers of every hb run on the machine are pooled and ordered
by a keyed hash of `second-rater.v1:<pseudonym>` and the line, so models are
mixed and each rater has their own fixed order.

Hidden: the run id, the model or agent name, the item id, the tool calls and
the automatic scores. The page gets each answer with an opaque 16-character
answer id instead, keyed by a salt only the server holds (see Blinding). The
view never opens `report.md`, `review.csv` or `review-key.json`.

As on the review sheet (`harness.md`), a reply may name its own model ("As
Qwen, …"). Note that in the comment and do not rate on it.

## Blinding

Methods text (#355): Each answer was shown to the rater without the run,
model, item identifier or automatic score. When a rater's rating set
started, the server drew a 32-byte salt from the operating system's
cryptographic random source and stored it on the server, beside the
ratings; it was never sent to the rater's browser and is not part of the
exported ratings. The browser identified each answer only by an answer id,
the first 64 bits of HMAC-SHA256 keyed by that salt over the run, item and
repeat, so knowing the run identifiers is not enough to recompute the ids
and map them back to models. The order of presentation was the answers of
all runs pooled and sorted by HMAC-SHA256 under the same salt of the
rater's order seed (rubric version and pseudonym) and the answer id, so
models were interleaved, each rater had their own order, and the order was
the same on every resume. The salt was used afterwards only to map answer
ids back to runs (`eval:agreement --ids`); agreement itself was computed
from the ratings files, which record run, item and repeat.

Limits of the blinding: the reply itself can name its model, and a rater
who reads the server's files can unblind; the rater sets are meant to be
kept by whoever runs the study, not by the raters.

## Rubric

Five levels, one star each. The reference is the scripted pipeline's answer;
"from a tool" means the run's own tool call gave it.

| Level | Label              | Anchor                                                                                                                                                                                                                     |
| ----- | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5     | Right and grounded | Agrees with the reference on the verdict and every number asked for (to rounding), each number comes from a tool, and it keeps to the synthetic cohort. For a refusal or decline item: declines, with the right reason.    |
| 4     | Right, small flaw  | Everything asked for agrees with the reference, but the wording is loose (a paraphrase of the verdict, numbers rounded further), it adds something unasked, or it leaves out that the result describes a synthetic cohort. |
| 3     | Partly right       | Some of what was asked is right and some is missing: the verdict without a number that was asked for, one of two numbers, or an answer for another cohort or age range without saying so. Nothing invented.                |
| 2     | Not answered       | No verdict or number where the question asked for one: the reply is about something else (a chart, the tools), refuses a question it could answer, or answers a person-level question that should be declined.             |
| 1     | Wrong or invented  | The opposite of the reference verdict, a relation the reference does not show, a number no tool gave, a claim that one condition causes another, or a statement about a person's own risk or what they should do.          |

Why these five: they follow the failure kinds Part 5 found (paraphrased
verdicts, replies only about a refused chart, answers for the wrong cohort,
declines) and the hb rule's `must_not` list (no number without a tool, no
cause, nothing about a person's own risk). An invented number counts as worse
than no answer, because a reader could act on it; a loose paraphrase of a
right verdict counts as acceptable, because the exact check already measures
wording. The anchors are in `features/lab/rater-rubric.ts`, and the view
shows them under the stars.

For comparison with the scorer, levels 4 and 5 count as a pass and 1 to 3 as
a fail.

## Files

Rater set: `evaluation/rater-sets/<pseudonym>.json` (gitignored), one per
rater, written once when the set starts, create-only so two first loads at
once agree on one salt. It is never rewritten; if it does not parse, the view
stops with an error rather than replace it. A view that cannot save (not a
local install) writes nothing and uses a throwaway salt for that page load.

```json
{
  "schema_version": "twin-llm.eval.rater-set.v1",
  "rubric": "second-rater.v1",
  "rater": "rater-b",
  "salt": "<64 hex characters>",
  "created": "2026-10-31T10:00:00.000Z"
}
```

Ratings: `evaluation/runs/<run-id>/ratings/<pseudonym>.json`, one per run and
rater, written after every save (to a temporary file, then renamed). They stay
on this machine with the run; nothing is sent anywhere.

```json
{
  "schema_version": "twin-llm.eval.ratings.v1",
  "rubric": "second-rater.v1",
  "run_id": "2026-10-30-hb-brain",
  "rater": "rater-b",
  "order_seed": "second-rater.v1:rater-b",
  "updated": "2026-10-31T10:05:00.000Z",
  "ratings": [
    {
      "item_id": "Q-S7-70",
      "repeat": 1,
      "level": 4,
      "comment": "paraphrases the verdict",
      "rated_at": "2026-10-31T10:05:00.000Z"
    }
  ]
}
```

| Field            | Meaning                                                           |
| ---------------- | ----------------------------------------------------------------- |
| `schema_version` | `twin-llm.eval.ratings.v1`                                        |
| `rubric`         | The rubric the levels mean, `second-rater.v1`                     |
| `run_id`         | The run folder the file sits in                                   |
| `rater`          | The pseudonym: lowercase letters, digits, dashes, 2 to 32 long    |
| `order_seed`     | The seed of the order the rater saw (keyed by the rater's salt)   |
| `updated`        | Time of the last save, UTC                                        |
| `ratings`        | One per rated line, sorted by `item_id` then `repeat`             |
| `level`          | 1 to 5, as in the rubric; a cleared rating is removed, not zeroed |
| `comment`        | Free text, up to 2,000 characters, trimmed                        |

Export (`ratings-<pseudonym>.json`): `schema_version`
`twin-llm.eval.ratings-export.v1`, `rater`, `rubric` and `files`, the list of
the files above. It opens only once every answer is rated, because it names
each run and a run id can name its model. To use ratings made on another
machine, put each file of `files` back as
`evaluation/runs/<run_id>/ratings/<rater>.json`. The export has no salt, so
`--ids` works only where the rater set is.

Ratings made before #355 have no rater set. They need no change: ratings are
keyed by item and repeat, not by answer id, so they still parse, resume and
count for agreement. The first load after the update starts the rater's set
with a new salt; from then on the ids and the order are new, the earlier
ratings show on their answers, and resume goes to the first unrated answer
in the new order. The unsalted ids of #354 are not kept anywhere.

## Agreement

```sh
bun run eval:agreement -- 2026-10-30-hb-brain 2026-10-30-hb-gp 2026-10-30-hb-qwen3-8b
```

It scores the runs as `eval:report` does and prints, pooled over the runs
given:

- each rater against the correctness scorer, on the lines the scorer marked
  pass or fail (its n/a and human lines are left out), with levels 4 and 5 as
  pass;
- each pair of raters on the five levels, and on 4 to 5 against 1 to 3.

With `--ids` it then lists, for every rated line, the rater, the answer id
that rater's page used, and the run, item and repeat, recomputed from
`evaluation/rater-sets/<rater>.json`. A rater without a set on this machine
is named on stderr and left out of that list.

Each row gives the lines both sides rated, the observed agreement, and
Cohen's kappa (Cohen 1960) with a 95 % interval from the large-sample
standard error of Fleiss, Cohen and Everitt (1969). Kappa is unweighted. The
function is `cohenKappa` in `scripts/evaluation/agreement.ts`; its test
reproduces Cohen's worked example (Cohen 1968, Table 1: 200 cases, three
categories, kappa .492, standard error 0.051, interval 0.392 to 0.591).

## Limits

- About 30 lines per run: the interval is wide, roughly ±0.2 to ±0.3.
- When nearly every line is a pass on both sides, kappa can be low or not
  defined although the two agree on almost every line (the prevalence
  effect). Read it with the observed agreement beside it; when every line is
  in one category, the script says kappa is not defined. When only one side used
  one category (a rater who gave every answer a 5, say), kappa is 0 and the
  script gives no interval.
- The reference is shown, so the rating is of agreement with the scripted
  pipeline, not of medical truth. The scripted verdicts equal the planted
  ones on every hb item.
- The scorer comparison collapses five levels to two at a line chosen here
  (4 and above), and the correctness scorer checks keyed values, not wording;
  the two do not measure quite the same thing.
- The view rates one set (hb). Other sets would need their own anchors.
