"""Downloads the MediaPipe Pose Landmarker model once, checked against a pin.

    uv run --group motion motion/fetch_model.py

The model (Apache-2.0, Google) is written to ``data/motion/models/`` at the
repository root, which is gitignored. This is the only step of the pipeline that
uses the network; ``video_to_clip.py`` never does.
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_heavy/float16/1/pose_landmarker_heavy.task"
)
MODEL_SHA256 = "64437af838a65d18e5ba7a0d39b465540069bc8aae8308de3e318aad31fcbc7b"
MODEL_BYTES = 30_664_242
REPO_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_MODEL = REPO_ROOT / "data" / "motion" / "models" / "pose_landmarker_heavy.task"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def model_ok(path: Path) -> bool:
    return path.is_file() and path.stat().st_size == MODEL_BYTES and sha256_file(path) == MODEL_SHA256


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--out", type=Path, default=DEFAULT_MODEL)
    args = parser.parse_args(argv)
    out: Path = args.out
    if model_ok(out):
        print(f"Already installed: {out}")
        return 0
    out.parent.mkdir(parents=True, exist_ok=True)
    partial = out.with_suffix(".partial")
    with urllib.request.urlopen(MODEL_URL, timeout=60) as response, partial.open("wb") as handle:
        while chunk := response.read(1 << 20):
            handle.write(chunk)
    got = sha256_file(partial)
    if got != MODEL_SHA256:
        partial.unlink()
        print(f"SHA-256 mismatch: got {got}, expected {MODEL_SHA256}. Nothing installed.", file=sys.stderr)
        return 1
    partial.replace(out)
    print(f"Installed {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
