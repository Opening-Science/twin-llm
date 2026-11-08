### Code over the record (#303)

| Arm            | Correctness      | Human share |
| -------------- | ---------------- | ----------- |
| tools          | 36/101 (27–45 %) | 11 %        |
| context-oracle | 52/85 (51–71 %)  | 25 %        |
| context-fair   | 6/78 (4–16 %)    | 32 %        |
| code           | 6/70 (4–17 %)    | 39 %        |

## Held-out set v1h (#304)

Run `2026-11-01-qwen3-4b-v1h` at commit 4b58ef5: qwen3:4b, tools arm, the 32 held-out items of v1h (`evaluation/questions.v1h.v1.json`), with repeats as in v1. 44 lines, 39 answered, no errors; the 5 S4 lines were skipped because the eval env has no GBD settings (#273). Results are under the gitignored `evaluation/runs/`.

| Criterion   | S1  | S2   | S3  | S5  | S6  | All             |
| ----------- | --- | ---- | --- | --- | --- | --------------- |
| correctness | 6/8 | 4/10 | 1/5 | —   | 7/7 | 18/30 (42–75 %) |
