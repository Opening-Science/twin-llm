# Python

The Python side of TwinLLM, kept apart from the app. Four things live here or will:

- **Fine-tuning** (`train` group): the scripts that train an open model on the
  conversations `docs/training-data.md` describes. The pilot-1 run was done from a
  folder outside this repository; its scripts move here next.
- **Evaluation analysis** (`analysis` group): `analysis/eval_report.py` reads one run's
  `results.jsonl` from `bun run eval` and prints, per model and scenario, how many lines
  ran, were answered, errored or were skipped. Pass and fail per criterion stay with
  `bun run eval:report`.
- **Motion from video** (`motion` group): `motion/video_to_clip.py` turns a video into a
  keyframe clip the Body twin plays, on this machine, with MediaPipe Pose
  (`docs/motion-from-video.md`). Clips go to the gitignored `data/motion/`.
- **The Carbon-X sidecar** (`carbon` group): `carbon/serve.py` serves the pinned
  Carbon-X DNA model in 4-bit on 127.0.0.1:8090 with an OpenAI-compatible chat route. A
  separate process the app would talk to over HTTP, not a module it imports. Research
  spike for #58; contract and limits in [`docs/carbon-x.md`](../docs/carbon-x.md).

## Setup

[uv](https://docs.astral.sh/uv/) manages this directory as one project, pinned in
`uv.lock`. From the repository root:

```sh
cd python
uv sync                    # pandas and pyarrow only
uv sync --group analysis   # plus matplotlib and pytest
uv sync --group train      # plus torch, transformers, peft, trl, datasets (large)
uv sync --group carbon     # plus torch, transformers, bitsandbytes, accelerate (large)
uv sync --group motion     # plus mediapipe, opencv and pytest
uv run --group motion pytest motion
uv run --group analysis pytest
uv run analysis/eval_report.py ../evaluation/runs/<run-id>/results.jsonl
```

Dependencies are pinned to exact versions; change them together with `uv.lock`.

## Rules

- **The app never imports Python.** Skills, MCP servers, the query tools and the chat
  route stay TypeScript. Python reads the files the harness and the training-data
  scripts write, and later serves the sidecar; it never runs inside the Next process.
- **Synthetic data only**, as everywhere in this repository (`CONTRIBUTING.md`, "Data
  and secrets"). Fixtures in tests are synthetic and mirror the TypeScript fixtures.
- Nothing here commits run output: `evaluation/runs/`, `training-data/out/` and
  `data/motion/` are gitignored, and so is `python/.venv/`.
