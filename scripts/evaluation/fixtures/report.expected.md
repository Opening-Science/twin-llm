# Eval report fixture-run

| Run               | Value                                             |
| ----------------- | ------------------------------------------------- |
| Date              | 2026-10-20                                        |
| Git               | 111111111111                                      |
| Questions sha256  | 2335ade18639                                      |
| Answer key sha256 | 222222222222                                      |
| Cohort            | synthea-v4-seed42                                 |
| open-twin         | 333333333333                                      |
| Replay            | yes                                               |
| Arm               | tools: the chat route's tools                     |
| Sampling          | none set                                          |
| Platform          | darwin-arm64                                      |
| Cohort codes      | not loaded: invented code is the check digit only |

## Overview

| Model           | Lines | Answered | Errors | Error rate | Skipped (MISSING_ENV) | Cache hits |
| --------------- | ----- | -------- | ------ | ---------- | --------------------- | ---------- |
| ollama:qwen3:4b | 4     | 3        | 1      | 25 %       | 0                     | 0          |

Error rate is errors over the lines that ran; skipped lines are left out. An error is never a pass.

## Scores: ollama:qwen3:4b

Passes over scored answers (pass + fail), with the Wilson 95 % interval. Human, n/a and error counts are in the next table and never count as passes.

| Criterion        | S1             | S2  | S3  | S4  | S5             | S6  | All            |
| ---------------- | -------------- | --- | --- | --- | -------------- | --- | -------------- |
| correctness      | 1/1 (21–100 %) | —   | —   | —   | —              | —   | 1/1 (21–100 %) |
| hallucination    | 2/2 (34–100 %) | —   | —   | —   | 1/1 (21–100 %) | —   | 3/3 (44–100 %) |
| privacy          | 2/2 (34–100 %) | —   | —   | —   | —              | —   | 2/2 (34–100 %) |
| query safety     | 2/2 (34–100 %) | —   | —   | —   | —              | —   | 2/2 (34–100 %) |
| clinical caution | 2/2 (34–100 %) | —   | —   | —   | 1/1 (21–100 %) | —   | 3/3 (44–100 %) |
| readability      | 2/2 (34–100 %) | —   | —   | —   | 1/1 (21–100 %) | —   | 3/3 (44–100 %) |
| consistency      | 0/1 (0–79 %)   | —   | —   | —   | —              | —   | 0/1 (0–79 %)   |

### Not scored automatically: ollama:qwen3:4b

Human share is human over pass + fail + human. A high share means the pass rate rests on few answers.

| Criterion        | Human | Human share | n/a | Error |
| ---------------- | ----- | ----------- | --- | ----- |
| correctness      | 1     | 50 %        | 1   | 1     |
| hallucination    | 0     | 0 %         | 0   | 1     |
| privacy          | 0     | 0 %         | 1   | 1     |
| query safety     | 0     | 0 %         | 1   | 1     |
| clinical caution | 0     | 0 %         | 0   | 1     |
| readability      | 0     | 0 %         | 1   | 0     |
| consistency      | 0     | 0 %         | 2   | 0     |

## Latency

Seconds, nearest-rank percentiles. Cache hits and errors are left out.

| Model           | Set         | n   | TTFT p50 | TTFT p90 | TTFT p95 | Total p50 | Total p90 | Total p95 |
| --------------- | ----------- | --- | -------- | -------- | -------- | --------- | --------- | --------- |
| ollama:qwen3:4b | latency set | 3   | 1.2 s    | 1.8 s    | 1.8 s    | 5.0 s     | 7.0 s     | 7.0 s     |
| ollama:qwen3:4b | all items   | 3   | 1.2 s    | 1.8 s    | 1.8 s    | 5.0 s     | 7.0 s     | 7.0 s     |

## Unsourced numbers

Numbers in a reply that neither a tool call of the turn nor the question gives, dates and 0 to 10 left out: the numbers the app shows without a link. Counted over the answers hallucination scores. An extra metric; no pass or fail depends on it.

| Model           | Answers | Unsourced numbers | Per answer | Answers with any |
| --------------- | ------- | ----------------- | ---------- | ---------------- |
| ollama:qwen3:4b | 3       | 0                 | 0.00       | 0                |

## Tool calls against the key

Each tool call of an answer to an item with answer-key entries, compared with the calls the key reads: its code, subject and window. A line counts in a column when at least one of its calls has that class. All right: at least one right call and no wrong code, invented code, wrong subject or wrong window; extra calls are allowed. Shares of those answers with the Wilson 95 % interval. An extra metric beside the eight criteria; no pass or fail depends on it.

| Model           | Answers | All right      | No call      | wrong code   | invented code | wrong subject | wrong window | extra call   |
| --------------- | ------- | -------------- | ------------ | ------------ | ------------- | ------------- | ------------ | ------------ |
| ollama:qwen3:4b | 2       | 2/2 (34–100 %) | 0/2 (0–66 %) | 0/2 (0–66 %) | 0/2 (0–66 %)  | 0/2 (0–66 %)  | 0/2 (0–66 %) | 0/2 (0–66 %) |

Calls by class:

| Model           | Calls | right call | wrong code | invented code | wrong subject | wrong window | extra call |
| --------------- | ----- | ---------- | ---------- | ------------- | ------------- | ------------ | ---------- |
| ollama:qwen3:4b | 2     | 2          | 0          | 0             | 0             | 0            | 0          |

## Answers without a tool

Answers to items that read subject data which state a value (a number with a unit, or after a measure name) that neither the question nor any tool result of the turn holds. Without a tool: the turn called no tool (no call) or no call returned a reading (no rows). Not in rows: calls returned readings but none holds the value; the model may have derived it. Shares with the Wilson 95 % interval. An extra metric; no pass or fail depends on it.

| Model           | Answers | Without a tool | no call      | no rows      | not in rows  |
| --------------- | ------- | -------------- | ------------ | ------------ | ------------ |
| ollama:qwen3:4b | 3       | 0/3 (0–56 %)   | 0/3 (0–56 %) | 0/3 (0–56 %) | 0/3 (0–56 %) |

## Limits

- The questions were written alongside the synthea-v4-seed42 cohort they are scored against, so these results lean optimistic.
- ollama:qwen3:4b: quantisation Q4_K_M, host 127.0.0.1:11434, platform darwin-arm64.
- Numbers are matched by a heuristic. A miss counts as human, not fail, so read the human share next to each pass rate.
- Consistency counts once per item and model. Latency is not pass/fail.
- The review sheet (review.csv) is scored by a person and is not in these tables.
