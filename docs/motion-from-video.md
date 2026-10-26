# Motion from a video

`python/motion/` turns a video of one person moving into a keyframe clip the Body twin
plays as **Dance (video)**. Everything runs on your machine: the video is read from disk,
poses come from a model file on disk, and nothing is uploaded. This is the pose spike of
issue #59.

## Make a clip from your own video

From the repository root, with [uv](https://docs.astral.sh/uv/):

```sh
cd python
uv sync --group motion
uv run --group motion motion/fetch_model.py      # once: the pose model, checked against its pin
uv run --group motion motion/video_to_clip.py ~/Videos/my-dance.mp4 --out ../data/motion/video-dance.json
```

Reload the Body twin: **Dance (video)** appears next to Walk, Run, Idle and Dance loop.
`data/motion/` is gitignored. Run the last command again to replace the clip.

Useful options:

- `--crop x,y,width,height` when the automatic crop picks the wrong area. By default the
  longest band of rows brighter than a black bar or caption strip is kept, across the
  full width.
- `--smooth-s 0.25` sets the smoothing window in seconds; `--max-gap-s 0.5` the longest
  stretch without a pose that is bridged.
- `--landmarks-out file.json` keeps the raw landmarks, and `--from-landmarks file.json`
  starts from them again without the model (quick to retune).
- `--no-level` keeps the camera's tilt; `--world-only` uses the 3D estimate's x and y
  too (see below).

A video works best with one person, whole body in view, the camera still and roughly
level, and the person mostly facing it.

## Rights

A clip is derived from the video and carries the video's rights. Keep a clip made from
someone else's footage on your machine: do not commit it, its frames or the video, and do
not publish them. The repository only holds the code and synthetic fixtures. The pose
model is Apache-2.0 (Google, MediaPipe) and is downloaded, not committed
(`PROVENANCE.md`).

## How it works

1. **Pose.** MediaPipe Pose Landmarker, heavy model, `mediapipe` 0.10.35 in video mode:
   33 landmarks per frame, in the picture and as 3D world points in metres. `mediapipe`
   1.1.1 was tried first; on the development machine its process was killed while
   creating the landmarker, so the pin is 0.10.35.
2. **Left and right.** A body without a face (or seen from behind) gives the model
   little cue to which way it faces, so it sometimes labels the left limbs right for a few
   frames. Each frame, upper and lower body separately, is compared with the previous one
   as is and swapped; the closer wins. When both halves were swapped the model had the
   body facing away, so the depth is mirrored too.
3. **Picture first.** The 2D points follow the video closely; the x and y of the 3D guess
   less so. The x and y are taken from the picture (centred between the hips, scaled to
   metres by the clip's median trunk length) and only the depth from the 3D guess. A
   limb's depth is then limited to what its length allows: a bone of length L drawn l
   long in the picture can reach at most √(L² − l²) toward or away from the camera (L is
   the bone's median 3D length over the clip).
4. **Gaps and smoothing.** Frames without a pose are bridged linearly up to 0.5 s, longer
   gaps hold the nearest pose. A Savitzky–Golay filter (0.25 s, quadratic) smooths every
   coordinate over the whole recording, so the result has no lag.
5. **Level.** The camera's tilt is removed so the clip's average ankles-to-shoulders line
   is vertical.
6. **Retargeting** (`retarget.py`). Zero rotation is the bind pose of the rigged ANNY demo
   body; its rest bone directions are constants in the file. For each segment the rest
   direction is mapped onto the measured one, and the turn about the segment comes from a
   second direction: the pelvis from the hip line and the vertical; the spine from the
   hips-to-shoulders line and the shoulder line, split evenly over the two spine joints;
   upper arm and thigh from the plane of the bent elbow or knee (near straight, the arm
   eases to the smallest swing from the chest and the thigh takes its turn from the
   foot); forearm, shin and foot by the smallest swing from where the parent carries
   them; the head from the ears and nose, relative to the clip's median head pose. Each
   rotation is stored relative to its parent. Limits keep a noisy frame from twisting a
   limb round: thigh twist ±35°, upper-arm twist ±80°, ankle 50°, head 40°.
7. **Planted feet** (`foot_contact.py`). A foot is planted when its lowest point
   (ankle, heel or toe, in the picture) is within 4 cm of the floor and it moves less
   than 0.35 m/s sideways; it lifts again above 7 cm or 0.6 m/s. The floor under a foot is
   the lowest it reached within a second either side, no higher than 12 cm above the
   lowest either foot reached. Contacts shorter than 0.1 s are dropped and breaks shorter
   than 0.1 s closed. The clip stores one flag per foot per frame.
8. **In place.** Travel across the floor is dropped. The hips' sideways offset over the
   midpoint of the ankles is kept (scaled to the ANNY body's legs), and the up and down of
   the body comes back by itself because the app keeps the lowest foot on the floor, so
   bent knees lower the hips.
9. **File.** `clip_builder.py` writes JSON: fps, joint ids, one row of quaternions per
   frame, the sideways offsets, the contact flags, the video's SHA-256, the licence note
   and how it was made. `features/digital-twin/motion/keyframe-clip.ts` checks it with a
   zod schema (the contact flags are optional, so older clips still load).

In the app (`features/digital-twin/motion/foot-contact.ts`), a planted foot's weight
ramps over 0.1 s round each change. While planted, the foot is laid flat (its
heel-to-toe line back at its rest slope; the landmarks' heel and toe are too noisy to
tell flat from pointed) and the leg is bent with two-bone IK (thigh and shin) so the
ankle stays where it was when that footfall began, with the foot's lowest point on the
floor. The pelvis is placed first: normally the lowest foot touches the floor; with both
feet planted, the higher one does, so the clip's bent knees keep the hips low and the
IK bends the other leg up to the floor instead of straightening it.

The pipeline is tested on synthetic landmarks made by forward kinematics from chosen
joint angles (`python/motion/synthetic.py`): retargeting recovers those angles exactly,
and the TypeScript player's tests load the clip the pipeline makes from them.

## What it does not do

- One person only; no hands or fingers, no forearm roll, no shoulder shrug (the clavicles
  stay at rest).
- Depth is the model's guess. An arm reaching toward or away from the camera can come out
  more sideways than it was.
- In place only: steps that travel, turns that carry the body across the floor, and jumps
  are not kept (a jump comes out as bent knees). A planted foot holds where its
  footfall began, so a long contact while the hips sway can stretch or bend that leg
  more than in the video.
- A planted foot is laid flat, so standing on the ball of the foot is not kept.
- The rest pose is ANNY's. A BodyLoop scan whose bind pose differs (a T-pose, say) will
  show that difference throughout, as it does for the computed clips.

## Spike result (#59, pose from video)

Go, for a local tool. On a 16 s, 24 fps phone recording of an animated dancer (720×1278
with captions above and below), the pipeline ran in under a minute on a laptop CPU,
found a pose in all 386 frames, undid 74 left/right swaps, and the twin matched the
video's arm heights, hip sway, knee bends and weight shifts at the compared times; with
the contact flags, planted feet stay flat on the floor. It is weakest where the model
is: depth of the arms (limiting it to the bones' lengths changed little for the arm
reaching toward the camera in the first seconds), the head of a body without a face, and
a few frames where the legs cross. The text-to-motion half of #59 is not covered here.
