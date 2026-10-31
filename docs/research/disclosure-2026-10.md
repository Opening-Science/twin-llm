# Disclosure on synthetic people (October 2026)

Issue #301, part of #140. Research use only, synthetic people only. Nothing here
estimates the risk for a real person or a model trained on real records.

## Question

Does the pilot 1 fine-tune (`finetune-pilot/REPORT.md`) reveal which synthetic
people were in its training data, or their values? A null on the pilot alone
could mean that the attacks are too weak, so the same attacks run on a
positive control: a small, deliberately overfit fine-tune on 40 synthetic
people. The attacks run on the training checkpoint and on the export Ollama
serves.

## How to run it

```sh
bun run disclosure:prepare -- --out ../twin-llm-disclosure-run     # sets, seconds
RUN=../twin-llm-disclosure-run scripts/disclosure/run-gpu.sh        # GPU, about 4 hours
bun run disclosure:analyze -- --run ../twin-llm-disclosure-run      # tables, seconds
```

`run-gpu.sh` uses the pilot's Python environment (read-only) and waits until no
other process holds more than 1 GB on the card. Every step is resumable. The
served exports are first turned back into fp16 checkpoints with
`scripts/disclosure/dequant_gguf.py` (gguf-py 0.19.0 in `<run>/pylib`); see
"Served export" below. Outputs, checkpoints and the 7.6 GB dequantized weights
stay in the run directory, outside the repository.

## Setup

| Item                    | Value                                                                                                  |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| Cohort                  | `synthea-v4-seed1001`, 68,906 conversations, 11,380 subjects with analytics questions                  |
| Cohort sha256           | `c95920c01278411d0b576665d8b20d0aa3795fec0cc8e9da2749b60c2d9ac3e9` (meta `a5b97d56…41ad8a1`)           |
| Pilot training file     | `finetune-pilot/data/train.jsonl`, 10,000 conversations, 6,910 subjects, sha256 `542e5529…a0c37df2`    |
| Pilot adapter           | `runs/pilot1/lora`, sha256 `0e400f55…227f5c23`; base `unsloth/Qwen3-4B-Instruct-2507-unsloth-bnb-4bit` |
| Served pilot            | `twinllm-qwen3-4b-pilot1`, q4_K_M blob `sha256-a03e361f…c4220864`                                      |
| Served base             | `twinllm-qwen3-4b-base`, q4_K_M blob `sha256-96638575…5b18bc4`                                         |
| Positive control        | 40 subjects, 194 conversations, 10 epochs, adapter sha256 `db1c917a…6b415b7f`                          |
| Seeds                   | sets 301, control 302, pilot probes 303, control probes 304; bootstrap and permutations 301            |
| Resamples, permutations | 1,000 bootstrap resamples over subjects; 9,999 label permutations                                      |

Every input hash and set count is in `<run>/sets/manifest.json`; the full
results are in [`disclosure-2026-10.summary.json`](disclosure-2026-10.summary.json).

**Members and non-members.** The cohort has one conversation per analytics
family (latest value, trend, baseline deviation, coverage, compare windows)
per subject. Members are subjects with at least one trained analytics
conversation; non-members appear in no trained conversation of any family. 500
of each are drawn, and each member is paired with a non-member so both classes
have the same family mix (`scripts/disclosure/splits.ts`).

- Record level: a conversation that was trained on, against a conversation of
  the same family about a non-member.
- Subject level: a conversation about a member that was never trained on,
  against one of the same family about a non-member. This asks whether the
  model gives away that a person was in the training data when the attacker
  does not hold the training text.

**Scoring.** Each conversation is rendered with the pilot's own renderer, so
the text is byte for byte what the pilot trained on, and only the trained
tokens are scored: everything in assistant turns, as Unsloth's
`train_on_responses_only` masked them (tool results render as user turns).
That is about 430 tokens of the roughly 3,450 in a conversation. The
2,351-token system prompt and tools block is computed once and its cache
reused; the first conversation of each run is also scored without the cache
as a check (fp16 4-bit kernels move single tokens by up to 1.3 nats, the means
agree within 0.002).

**Attacks** (`scripts/disclosure/metrics.ts`), each a score per conversation,
higher meaning "member": loss (mean log-probability), reference (target minus
reference model, offline form of Carlini et al. 2022), Min-K% with K = 20 (Shi
et al. 2024), zlib ratio (Carlini et al. 2021) and the reference attack on
digit tokens only (values, dates, ids). The reference model is the base model,
and for the positive control also pilot 1, which was trained on the same
templates but never on the control's people. AUROC with a bootstrap over
subjects; TPR at 1% FPR with an exact (Clopper-Pearson) interval.

**Positive control** (`scripts/disclosure/train_control.py`). The pilot's
settings scaled down: same 4-bit base, QLoRA r = 16, alpha 16, all linear
layers, lr 2e-4 cosine, 3% warmup, adamw_8bit, batch 4 x 4, loss on assistant
turns only, same template and tools; 10 epochs on every conversation of 40
subjects except one held-out analytics conversation each (194 conversations,
130 steps, 77 minutes, 5.6 GiB). Final training loss 0.0004; loss on the
non-members' conversations 0.0038.

**Value probes.** 200 latest-value conversations that were trained on and 200
about non-members (control: 30 and 37). Two forms, both greedy and without the
tool call or its result in context:

- free answer: the training system prompt and the question, no tools;
- completion: the same prompt followed by the reference answer up to the
  value ("…It returned one row: "), so that the next tokens are the value.

An answer discloses when it states one of the true numbers (the tool value or
the number the reference answer stated), with subject ids, LOINC codes, dates
and digits inside words removed first (`scripts/disclosure/values.ts`). The
non-member rate is the chance rate.

**Served export.** Ollama 0.33.3 returns log-probabilities only for tokens it
generates, not for a given text. The q4_K_M blobs Ollama serves were therefore
dequantized tensor by tensor with gguf-py into fp16 checkpoints and scored
with the same code: the served weights, not the served runtime. The relative
error against the merged export the GGUF was made from is 0.072 on a sampled
tensor, the usual size for 4-bit. The value probes ran through Ollama itself
(`/api/chat`, and `/api/generate` in raw mode for completions).

## Results

### Membership inference: pilot 1

| Weights                                 | Attack    | Level   | AUROC (95% CI)         | TPR at 1% FPR (95% CI) |
| --------------------------------------- | --------- | ------- | ---------------------- | ---------------------- |
| Training checkpoint (4-bit base + LoRA) | Reference | record  | 0.517 (0.483 to 0.551) | 1.4% (0.6% to 2.9%)    |
|                                         | Loss      | record  | 0.500 (0.467 to 0.536) | 1.0% (0.3% to 2.3%)    |
|                                         | Reference | subject | 0.503 (0.468 to 0.541) | 1.6% (0.7% to 3.1%)    |
|                                         | Loss      | subject | 0.517 (0.481 to 0.551) | 1.0% (0.3% to 2.3%)    |
| Served export (q4_K_M weights)          | Reference | record  | 0.519 (0.484 to 0.552) | 1.0% (0.3% to 2.3%)    |
|                                         | Loss      | record  | 0.512 (0.476 to 0.546) | 1.0% (0.3% to 2.3%)    |
|                                         | Reference | subject | 0.508 (0.473 to 0.547) | 1.6% (0.7% to 3.1%)    |
|                                         | Loss      | subject | 0.508 (0.472 to 0.543) | 1.0% (0.3% to 2.3%)    |

500 members and 500 non-members per level. All 20 attack and level cells per
set of weights are in the summary; every interval includes 0.5 (largest
lower bound 0.484), and TPR at 1% FPR stays between 0.8% and 2.6%. On this
sample, membership in pilot 1's training data cannot be told apart from
chance, at either level, on either set of weights.

### Membership inference: positive control

| Reference model | Attack                 | Level   | AUROC (95% CI)         | TPR at 1% FPR (95% CI) |
| --------------- | ---------------------- | ------- | ---------------------- | ---------------------- |
| none            | Loss                   | record  | 0.708 (0.591 to 0.806) | 10.0% (2.8% to 23.7%)  |
| none            | zlib ratio             | record  | 0.709 (0.591 to 0.815) | 12.5% (4.2% to 26.8%)  |
| base            | Reference              | record  | 0.516 (0.386 to 0.640) | 2.5% (0.1% to 13.2%)   |
| pilot 1         | Reference              | record  | 0.782 (0.676 to 0.870) | 17.5% (7.3% to 32.8%)  |
| pilot 1         | Reference, digits only | record  | 0.694 (0.583 to 0.810) | 12.5% (4.2% to 26.8%)  |
| none            | Loss                   | subject | 0.532 (0.404 to 0.659) | 2.5% (0.1% to 13.2%)   |
| pilot 1         | Reference              | subject | 0.542 (0.410 to 0.666) | 2.5% (0.1% to 13.2%)   |
| pilot 1         | Reference, digits only | subject | 0.568 (0.433 to 0.690) | 0.0% (0.0% to 8.8%)    |

40 members and 40 non-members per level. The attacks do detect the control's
training conversations: the loss attack reaches 0.71 and the reference attack
with pilot 1 as reference 0.78, both with lower bounds well above 0.5. So the
pilot's null is not only a sign of a blind attack. The signal is modest even
after 10 epochs, because most trained tokens are template the base model
already predicts after one pass over the templates; the base model is a poor
reference (0.52) for that reason, a same-distribution fine-tune a good one.
At the subject level no attack separates members from non-members, even on
the overfit control: a fresh conversation about a trained person is predicted
no better than one about a stranger.

### Exact values

| Model                    | Probe      | Members      | Non-members  | Permutation p |
| ------------------------ | ---------- | ------------ | ------------ | ------------- |
| Pilot 1 checkpoint       | free       | 0/200        | 0/200        | 1.000         |
| Pilot 1 served by Ollama | free       | 0/200        | 2/200        | 0.487         |
| Pilot 1 checkpoint       | completion | 2/200 (1.0%) | 5/200 (2.5%) | 0.445         |
| Pilot 1 served by Ollama | completion | 0/200        | 5/200 (2.5%) | 0.063         |
| Base checkpoint          | completion | 1/200 (0.5%) | 4/200 (2.0%) | 0.369         |
| Base served by Ollama    | completion | 0/200        | 5/200 (2.5%) | 0.057         |
| Positive control         | free       | 0/30         | 0/37         | 1.000         |
| Positive control         | completion | 1/30 (3.3%)  | 0/37         | 0.449         |
| Base, control probes     | completion | 1/30 (3.3%)  | 1/37 (2.7%)  | 1.000         |

Wilson intervals for every rate are in the summary. Neither fine-tune states a
member's value more often than a non-member's, and both stay at the base
model's chance rate (a plausible guess sometimes hits). Asked freely, the
fine-tunes do not even try: pilot 1 answers all 400 tool-less questions (399 through Ollama) with its "other people" refusal template and the control all 67 with its dose refusal, a template-following failure of their own. In the training data every
value is copied from a tool result in the same conversation, so the trained
target is "copy the number from the context", not "remember this person's
number"; without the tool result there is nothing to copy.

### Checkpoint against served export

The attacks behave the same on both: no record- or subject-level AUROC differs
by more than 0.02. Per conversation, the reference scores of the checkpoint
and the served weights correlate at r = 0.97, the loss scores at r = 0.06.
The fine-tune's loss on these texts is about 0.0006 nats per token, so the
4-bit rounding of the export (and the bitsandbytes kernels of the checkpoint)
reorder conversations almost at random; the base model's loss, about 1.15,
dominates the reference score and survives quantization. A loss attack on a
quantized export of a fine-tune this confident therefore measures mostly
quantization noise.

## Limits

- **Synthetic people and templates.** The conversations come from fixed
  templates filled with tool results; person-specific content is a few numbers
  and an id. Real conversations are more varied and could leak more. These
  results support the method, not a claim about real data.
- **One pilot, one control, small control.** One fine-tune of each kind and one
  seed. With 40 control subjects the intervals are about 0.2 wide. The control
  was trained on 194 conversations for 10 epochs; a larger or longer control
  would show where the subject-level signal starts, if it does.
- **No shadow models.** LiRA with shadow fine-tunes (6.9 hours each for the
  pilot's size) was not run. Using pilot 1 as the control's reference is a
  single same-distribution reference, the simplest form of that idea.
- **Served weights, not served runtime.** The q4_K_M weights were scored in
  fp16 with PyTorch kernels, not llama.cpp's. Ollama 0.33.3 does not return
  log-probabilities for a given text; only the value probes used Ollama itself.
- **Sample size for the pilot.** 500 members and 500 non-members detect an
  AUROC of about 0.55; a smaller effect would read as "not distinguishable at
  this sample size", which is what is reported, not "no leakage".
- **No multiple-testing correction.** Ten attack and level cells per model are
  reported with unadjusted intervals. Every interval of the pilot's contains 0.5; the control's record-level loss and pilot-reference cells have
  lower bounds near 0.6 and 0.7.
- **The value matcher.** Exact equality with the stated or raw value, after
  removing ids, codes, dates and digits inside words; an answer that rounds
  differently is missed. A first run counted the "1" in "HbA1c" as a number;
  the matcher was fixed, the tests extended and the completion probes run
  again before the numbers above.
