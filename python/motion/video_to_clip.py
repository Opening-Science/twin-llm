"""A video of one person moving to a keyframe clip the Body twin can play.

    uv run --group motion motion/fetch_model.py          # once, the only download
    uv run --group motion motion/video_to_clip.py VIDEO --out ../data/motion/video-dance.json

Runs entirely on this machine: the video is read with OpenCV, poses come from
the MediaPipe Pose Landmarker model on disk, and nothing is sent anywhere.

Steps: find the picture area (rows of captions or black bars above and below
are cut, or pass ``--crop``), estimate 3D world landmarks per frame, fill short
gaps, limit limb depths to the bones' lengths, find planted feet
(``foot_contact.py``), smooth with a Savitzky–Golay filter, level the camera's
tilt, turn the landmarks into joint rotations (``retarget.py``) and write the clip
(``clip_builder.py``). ``--landmarks-out`` keeps the raw landmarks and
``--from-landmarks`` starts from such a file instead of a video (the tests do).

The clip is derived from the video, so it carries the video's rights: keep a
clip made from someone else's footage out of the repository. ``data/motion/``
is gitignored for that reason.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path
from typing import Any

import numpy as np

from clip_builder import build_clip, level
from fetch_model import DEFAULT_MODEL, MODEL_SHA256, model_ok
from foot_contact import foot_contacts
from landmark_filter import (
    anchor_to_picture,
    bone_lengths,
    consistent_depth,
    fill_gaps,
    fix_swaps,
    savgol,
    window_frames,
)
from retarget import LANDMARK_COUNT, to_body_frame

DEFAULT_LICENCE = (
    "Derived from a video supplied on this machine; it carries that video's rights. "
    "Keep it local unless you own the footage."
)
#: Rows darker than this (0-255 mean) are bars or captions, not the picture.
PICTURE_MIN_LUMA = 60.0


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def picture_rows(row_luma: np.ndarray, min_luma: float = PICTURE_MIN_LUMA) -> tuple[int, int]:
    """The longest run of rows bright enough to be picture rather than a black
    bar or caption band: (first row, end row exclusive)."""
    bright = row_luma >= min_luma
    best = (0, len(row_luma))
    best_len = 0
    i = 0
    while i < len(bright):
        if not bright[i]:
            i += 1
            continue
        start = i
        while i < len(bright) and bright[i]:
            i += 1
        if i - start > best_len:
            best, best_len = (start, i), i - start
    return best


def parse_crop(text: str) -> tuple[int, int, int, int]:
    parts = [int(v) for v in text.split(",")]
    if len(parts) != 4 or parts[2] <= 0 or parts[3] <= 0:
        raise argparse.ArgumentTypeError("--crop is x,y,width,height in pixels")
    return parts[0], parts[1], parts[2], parts[3]


def detect_video(
    video: Path, model: Path, crop: tuple[int, int, int, int] | None
) -> dict[str, Any]:
    """World landmarks per frame (MediaPipe convention), None where no pose."""
    import cv2  # noqa: PLC0415 - heavy, only for real videos
    import mediapipe as mp  # noqa: PLC0415
    from mediapipe.tasks.python import BaseOptions, vision  # noqa: PLC0415

    def frames():
        capture = cv2.VideoCapture(str(video))
        if not capture.isOpened():
            raise SystemExit(f"Cannot read {video}")
        try:
            while True:
                ok, image = capture.read()
                if not ok:
                    return
                yield image
        finally:
            capture.release()

    probe = cv2.VideoCapture(str(video))
    fps = float(probe.get(cv2.CAP_PROP_FPS)) or 30.0
    count = int(probe.get(cv2.CAP_PROP_FRAME_COUNT)) or 1
    width = int(probe.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(probe.get(cv2.CAP_PROP_FRAME_HEIGHT))
    probe.release()
    if crop is None:
        # Frames are streamed, never all held: a phone video is gigabytes decoded.
        step = max(1, count // 24)
        luma = np.median(
            [
                cv2.cvtColor(im, cv2.COLOR_BGR2GRAY).mean(axis=1)
                for i, im in enumerate(frames())
                if i % step == 0
            ],
            axis=0,
        )
        top, bottom = picture_rows(luma)
        crop = (0, top, width, bottom - top)
    x, y, w, h = crop
    options = vision.PoseLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model)),
        running_mode=vision.RunningMode.VIDEO,
        num_poses=1,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
    )
    world: list[list[list[float]] | None] = []
    image_points: list[list[list[float]] | None] = []
    visibility: list[list[float] | None] = []
    with vision.PoseLandmarker.create_from_options(options) as landmarker:
        for index, image in enumerate(frames()):
            rgb = cv2.cvtColor(image[y : y + h, x : x + w], cv2.COLOR_BGR2RGB)
            result = landmarker.detect_for_video(
                mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb)),
                int(round(index * 1000 / fps)),
            )
            if not result.pose_world_landmarks:
                world.append(None)
                image_points.append(None)
                visibility.append(None)
                continue
            world.append([[p.x, p.y, p.z] for p in result.pose_world_landmarks[0]])
            image_points.append(
                [[x + p.x * w, y + p.y * h] for p in result.pose_landmarks[0]]
            )
            visibility.append([float(p.visibility or 0.0) for p in result.pose_world_landmarks[0]])
    return {
        "fps": fps,
        "size": [width, height],
        "crop": list(crop),
        "world": world,
        "image": image_points,
        "visibility": visibility,
        "mediapipe": mp.__version__,
    }


def track_from(landmarks: dict[str, Any], key: str = "world", dims: int = 3) -> np.ndarray:
    rows = [
        np.full((LANDMARK_COUNT, dims), np.nan) if frame is None else np.asarray(frame, dtype=float)
        for frame in landmarks[key]
    ]
    return np.stack(rows)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("video", type=Path, nargs="?", help="the video to read")
    parser.add_argument("--out", type=Path, required=True, help="clip JSON to write")
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL)
    parser.add_argument("--crop", type=parse_crop, help="x,y,width,height; default: detected")
    parser.add_argument("--from-landmarks", type=Path, help="start from saved landmarks")
    parser.add_argument("--landmarks-out", type=Path, help="also save the raw landmarks")
    parser.add_argument("--name", default="Dance (video)")
    parser.add_argument("--licence", default=DEFAULT_LICENCE)
    parser.add_argument("--smooth-s", type=float, default=0.25, help="smoothing window, s")
    parser.add_argument("--max-gap-s", type=float, default=0.5, help="longest gap to bridge, s")
    parser.add_argument("--no-level", action="store_true", help="keep the camera's tilt")
    parser.add_argument(
        "--world-only",
        action="store_true",
        help="use the 3D estimate's x and y too, not the picture's",
    )
    args = parser.parse_args(argv)

    if args.from_landmarks:
        landmarks = json.loads(args.from_landmarks.read_text())
        source = {"landmarks": args.from_landmarks.name, **landmarks.get("source", {})}
    else:
        if args.video is None:
            parser.error("give a video or --from-landmarks")
        if not model_ok(args.model):
            print(
                f"The pose model is missing or not the pinned file: {args.model}. "
                "Run: uv run --group motion motion/fetch_model.py",
                file=sys.stderr,
            )
            return 1
        landmarks = detect_video(args.video, args.model, args.crop)
        source = {"sha256": sha256_file(args.video)}
        landmarks["source"] = source
        if args.landmarks_out:
            args.landmarks_out.parent.mkdir(parents=True, exist_ok=True)
            args.landmarks_out.write_text(json.dumps(landmarks))

    fps = float(landmarks["fps"])
    raw = track_from(landmarks)
    picture = track_from(landmarks, "image", 2) if "image" in landmarks else None
    unswapped, picture, swaps = fix_swaps(raw, picture)
    scale = None
    if picture is not None and not args.world_only:
        unswapped, scale = anchor_to_picture(unswapped, picture)
    max_gap = int(round(args.max_gap_s * fps))
    filled, gaps = fill_gaps(unswapped, max_gap=max_gap)
    contacts = None
    if scale is not None and picture is not None:
        filled = consistent_depth(filled, bone_lengths(raw))
        contacts = foot_contacts(fill_gaps(picture, max_gap=max_gap)[0], scale, fps)
    window = window_frames(args.smooth_s, fps)
    smooth = savgol(filled, window, order=2)
    body = to_body_frame(smooth)
    tilt = 0.0
    if not args.no_level:
        body, tilt = level(body)
    clip = build_clip(
        body,
        fps,
        name=args.name,
        source={
            **source,
            "frames": len(raw),
            "durationS": round(len(raw) / fps, 3),
            **({"crop": landmarks["crop"]} if "crop" in landmarks else {}),
        },
        licence=args.licence,
        contacts=contacts,
        generator={
            "tool": "python/motion/video_to_clip.py",
            "estimator": "MediaPipe Pose Landmarker heavy (float16 v1)",
            "modelSha256": MODEL_SHA256,
            **({"mediapipe": landmarks["mediapipe"]} if "mediapipe" in landmarks else {}),
            "smoothing": {"filter": "savitzky-golay", "windowFrames": window, "order": 2},
            "gaps": {"missing": gaps.missing, "filled": gaps.filled, "held": gaps.held},
            "leftRightSwapsFixed": swaps,
            "anchoredToPicture": scale is not None,
            "depthFromBoneLengths": scale is not None,
            "levelledDeg": round(tilt, 2),
        },
    )
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(clip, separators=(",", ":")) + "\n")
    print(
        f"{args.out}: {clip['frameCount']} frames at {fps:g} fps; "
        f"{gaps.missing} without a pose ({gaps.filled} bridged, {gaps.held} held); "
        f"{swaps} left/right swaps undone; tilt {tilt:.1f}° removed"
        + (
            f"; feet planted {sum(contacts['footL'])} and {sum(contacts['footR'])} frames."
            if contacts
            else "."
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
