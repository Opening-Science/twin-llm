# Motion spikes, October 2026: own gait and text-to-motion

Two research spikes for #59: (a) pose from a phone video on the person's own machine,
retargeted onto their scan or the rigged demo body; (b) an open text-to-motion model as a
local Python sidecar. Licences were checked first, from the projects' own repositories,
model cards and licence pages (2026-10-30). Research use only: a clip is a visual cue, not a
measurement of anyone's movement, and nothing here is gait analysis or clinical advice.

The pipeline for (a) already exists (`python/motion/`, `docs/motion-from-video.md`). This
note checks its licences, lists the retargeting gaps against the scan rig, measures it
against known joint angles, and sets the privacy design. The only real video used is an
openly licensed clip published with a research paper; no one was filmed for this spike.

## Licences

"Local on the 2080 Ti" means the RTX 2080 Ti 11 GB of the development machine, which also
drives the desktop and often holds an Ollama model (5 GB in use during this spike).

| Item                                       | Code                    | Weights and training data                                                                                                                                                                                                                                                                                                                         | Local on the 2080 Ti                                                                    | Weights redistributable by us                                                                       | Terms on TwinLLM's users                                                                                                      |
| ------------------------------------------ | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| MediaPipe Pose Landmarker (BlazePose GHUM) | Apache-2.0 (repository) | Model card: "Licensed under Apache License, Version 2.0". Trained on images including 30K consented images. Out of scope by the card: several people, more than about 4 m away, head not visible, metric accurate depth, surveillance or identity recognition. Not for life-critical decisions.                                                   | Yes, CPU only (30 MB heavy model). 12 fps on 720×480, 9 fps on 540×960, on an i7-9700K. | Yes (Apache-2.0, keep the notice). We download it with a pinned SHA-256 instead (`fetch_model.py`). | Apache-2.0 notice only. `@mediapipe/tasks-vision` 1.2.0 for the browser is Apache-2.0 too.                                    |
| RTMPose (MMPose)                           | Apache-2.0              | MMPose publishes checkpoints with the code; the body models are trained on COCO plus AIC, and the "Body8" models on eight public sets. Each set has its own terms; not checked one by one.                                                                                                                                                        | Yes, small (RTMPose-m about 14 M parameters).                                           | Unclear until the training sets' terms are checked.                                                 | Depends on those sets. 2D only: 3D needs a separate lifting model, whose usual training set (Human3.6M) is academic use only. |
| ViTPose                                    | Apache-2.0              | Checkpoints on OneDrive, trained on COCO (ViTPose+ adds AIC, MPII and others). No separate weights licence stated.                                                                                                                                                                                                                                | Yes (ViTPose-B about 90 M parameters).                                                  | Unclear, as above.                                                                                  | As above; also 2D only.                                                                                                       |
| MoMask                                     | MIT                     | Checkpoints on Google Drive, trained on HumanML3D or KIT-ML. README: the code "uses datasets which each have their own respective licenses that must also be followed".                                                                                                                                                                           | Yes; the authors say the demo runs on a CPU. Not run here.                              | No (HumanML3D motion comes from AMASS, see below).                                                  | AMASS terms: non-commercial research only.                                                                                    |
| MDM (motion diffusion model)               | MIT                     | Trained on HumanML3D; uses CLIP. Same dataset note in its README.                                                                                                                                                                                                                                                                                 | Likely (README: one CUDA GPU); not run here.                                            | No, same reason.                                                                                    | Same.                                                                                                                         |
| T2M-GPT                                    | Apache-2.0              | Trained on HumanML3D and KIT-ML; trained on one 32 GB V100.                                                                                                                                                                                                                                                                                       | Inference likely; training not on 11 GB as published.                                   | No, same reason.                                                                                    | Same.                                                                                                                         |
| MotionGPT                                  | MIT                     | `OpenMotionLab/MotionGPT-base` on Hugging Face: one 1.33 GB checkpoint, card licence just "cc" (no version or terms named), trained on HumanML3D.                                                                                                                                                                                                 | Likely; not run here.                                                                   | No: the licence is unclear and the data is AMASS-derived.                                           | Same.                                                                                                                         |
| HumanML3D                                  | MIT (scripts and texts) | The motions are not distributed: the README says AMASS's distribution policy forbids it, and gives scripts to rebuild them from AMASS (and HumanAct12) with the SMPL+H and DMPL body models.                                                                                                                                                      | n/a                                                                                     | Text descriptions yes (MIT); motions no.                                                            | Rebuilding needs an AMASS account and its licence.                                                                            |
| AMASS                                      | n/a                     | Max Planck licence: use "for the sole purpose of performing non-commercial scientific research, non-commercial education, or non-commercial artistic projects"; no copying, sharing or distribution "in whole or in part"; it "prohibits the use of the Dataset to train methods/algorithms/neural networks/etc. for commercial use of any kind". | n/a                                                                                     | No.                                                                                                 | Non-commercial research only.                                                                                                 |
| CMU Graphics Lab Motion Capture Database   | n/a                     | Free for all uses; may be included in products sold commercially but not resold as data, even converted. The CMU site timed out on 2026-10-30, so this is from copies of its FAQ; check the site before relying on it.                                                                                                                            | n/a                                                                                     | Yes, inside a product; not as a data set.                                                           | None beyond the acknowledgement CMU asks for.                                                                                 |

What AMASS means for the models above: the weights are not data, but they were trained on
it, and the AMASS licence forbids training networks for commercial use and sharing the data
"in any form" without written permission. A licence on the code (MIT or Apache-2.0) does not
change the terms on the data the checkpoints came from. TwinLLM is research software, but it
is published openly and anyone can run it for any purpose. If we shipped, downloaded or
recommended these checkpoints by default, we would be passing on non-commercial terms that
our own licence does not show. This matches the earlier decision in `docs/chat-platform.md`:
any motion capture stays CMU only, since AMASS and SMPL are non-commercial.

## (a) Phone video to pose, on the machine, onto the person's rig

### What exists

`python/motion/video_to_clip.py` reads a video from disk, runs MediaPipe Pose Landmarker
(heavy) on the CPU, fixes left and right swaps, takes x and y from the picture and depth from
the model's 3D guess, smooths, levels, finds planted feet and writes a keyframe clip of joint
rotations that the Body twin plays (`docs/motion-from-video.md`). The model is downloaded
once with a pinned SHA-256; the pipeline makes no network calls.

### Proof run

A throwaway environment outside the repository (`uv`, `mediapipe` 0.10.35, CPU; the GPU
was busy with an Ollama model), two sample clips, nothing committed:

1. **Synthetic render (main test).** The rigged ANNY demo body
   (`anny-adult-m.rigged.glb`), posed by textbook-shaped sagittal gait curves (hip
   −8° to 28°, knee 5° to 60°, arm swing ±16°, 0.9 cycles per second, walking in place),
   skinned with linear blend skinning and drawn from 55° off the front: 120 frames at
   30 fps, 540×960. No person was filmed, and the joint angles are known exactly.
2. **Openly licensed clip (failure case).** "A novel walking speed estimation scheme ...",
   supplementary video 1 (Yoon, Park and Damiano 2012, Journal of NeuroEngineering and
   Rehabilitation, CC BY 2.0, via Wikimedia Commons; a healthy adult on a treadmill, seen from
   the side, head out of the frame, legs partly behind a handrail).

The proof script writes one row of joint angles per frame (hip flexion, knee flexion and
shoulder flexion per side, in the body's sagittal plane) and one annotated frame.

Synthetic render against the known angles (all 120 frames found a pose, 0 left and right
swaps):

| Angle      | Mean absolute error | Correlation | Truth range | Estimated range |
| ---------- | ------------------- | ----------- | ----------- | --------------- |
| Hip L      | 8.0°                | 0.99        | −8° to 28°  | −9° to 15°      |
| Hip R      | 13.0°               | 0.97        | −8° to 28°  | −16° to 9°      |
| Knee L     | 8.0°                | 0.90        | 5° to 60°   | 7° to 55°       |
| Knee R     | 5.5°                | 0.94        | 5° to 60°   | 3° to 50°       |
| Shoulder L | 6.2°                | 0.79        | −16° to 16° | −17° to 7°      |
| Shoulder R | 4.0°                | 0.97        | −16° to 16° | −14° to 8°      |

The timing and shape of each curve are kept (correlation 0.79 to 0.99). The size is not:
hip flexion comes out 10° to 20° short at its peak, so the whole curve sits low. Part of this
is how the angle is measured (the trunk line from landmarks, not the pelvis), and part is the
model's depth. The rendered body is ANNY, the body the pipeline's rest pose was measured on,
and it has no clothes, hair or background clutter, so a phone video is unlikely to do better. The full pipeline turned the same landmarks into a 120-frame clip, but found
planted feet in only 0 and 7 frames: a foot walking in place slides back under the body
faster than the 0.35 m/s the contact rule allows. Walking on a treadmill or in place needs a
contact rule on height alone.

The treadmill clip broke the model's input contract: with the head out of the frame the
model placed the shoulders on the real hips and the hips near the knees, so its angles are
wrong even where a pose was found (1151 of 1346 frames). The left and right fix then swapped
1259 body halves, because seen from the side the legs pass each other every step.

### Retargeting onto the 31-joint rig

The pipeline maps 33 MediaPipe landmarks onto TwinLLM's 16 clip joints
(`features/digital-twin/motion/gait.ts`), and `rig-map.ts` binds those by name to ANNY's
bones or to the scans' Mixamo-style skeleton.

| Clip joint        | Landmarks used                             | Scan bone (Mixamo-style)  | ANNY bone         |
| ----------------- | ------------------------------------------ | ------------------------- | ----------------- |
| pelvis            | hips 23, 24 and the vertical               | `Hips`                    | `root`            |
| spineLower, Upper | hips to shoulders 11, 12, split evenly     | `Spine`, `Spine2` (or 1)  | `spine05`, `02`   |
| clavicleL, R      | none (kept at rest)                        | `LeftShoulder`, `Right…`  | `clavicle.L`, `R` |
| upperArmL, R      | shoulder 11/12 to elbow 13/14, elbow plane | `LeftArm`, `RightArm`     | `upperarm01.*`    |
| lowerArmL, R      | elbow to wrist 15/16                       | `LeftForeArm`, `Right…`   | `lowerarm01.*`    |
| upperLegL, R      | hip to knee 25/26, knee plane or foot      | `LeftUpLeg`, `RightUpLeg` | `upperleg01.*`    |
| lowerLegL, R      | knee to ankle 27/28                        | `LeftLeg`, `RightLeg`     | `lowerleg01.*`    |
| footL, R          | heel 29/30 to toe 31/32                    | `LeftFoot`, `RightFoot`   | `foot.*`          |
| head              | ears 7, 8 and nose 0                       | `Head`                    | `head`            |

Missing or approximate:

- Not driven: `Spine1` (when `Spine2` is bound), `Neck`, the clavicles (no shrug), the
  hands and the forearm roll (landmarks 17 to 22 on the hand are read but unused), the toes
  (`ToeBase` only keeps a pushed-off foot out of the floor) and the end sites
  (`HeadTop_End`, `Toe_End`). The spine bend is split evenly between two joints.
- Rest pose: the rest bone directions in `retarget.py` are measured on ANNY's bind pose. A
  scan whose bind pose differs (a T-pose) shows that difference throughout. For a person's
  own scan the rest directions should be measured from that rig at load, as `rig-map.ts`
  already does for the body frame.
- Scale: rotations carry no length, so the person's own bone lengths come from their scan.
  Only the hips' sideways offset is a length; it is scaled to ANNY's legs today and should be
  scaled to the scan's.
- Feet: contact comes from the picture (lowest foot point within 4 cm of the floor and under
  0.35 m/s sideways). It holds for dance on the spot and fails for walking in place or on a
  treadmill (above). Travel across the floor is dropped, so walking over ground plays in
  place.
- Depth: the model's guess. Limbs reaching toward or away from the camera come out too
  sideways, and sagittal angles seen from the front are the weakest. A view 30° to 60° off
  the front, whole body and head in view, gave the results above.

### Privacy design

- The video never leaves the device. Today the person copies it to their own machine and
  runs the script there; a later version can run the same model in the browser tab
  (`@mediapipe/tasks-vision`, Apache-2.0, WebAssembly) so the video never reaches even the
  local server. No provider or chat model ever sees the video, its frames or landmarks.
- Nothing is stored but joint angles: the clip (rotations per frame, planted-foot flags, the
  hips' sideways offset, the video's SHA-256 and how it was made). The raw landmarks file is
  off by default and only for tuning; frames are never written.
- Only with consent: a clip from the person's own video is personal data (gait can identify
  a person). It is stored only after the person agrees, can be deleted, and is never used to
  train or tune anything without the explicit consent of #145. It stays in gitignored
  `data/motion/` today; as personal data it belongs with the imports of
  `docs/personal-data.md` (list, rename, delete, audit row).
- The view labels it as traced from a video by pose estimation, approximate, and not a
  measurement.

### Verdict: Go with conditions

Go for a local, consented tool that plays a person's own movement on their scan as a visual
cue. Conditions: whole body and head in view, one person, camera still, 30° to 60° off the
front for walking; the angles are not shown as numbers or used as gait measures (errors of
5° to 13° on average and peaks 10° to 20° short); clips are stored only with consent (#145).

Effort: rest directions measured per rig and the offset scaled to the scan, about 2 days;
a height-only contact rule for walking in place, about 1 day; consent, storage with the
personal data imports and deletion, about 3 days; running in the browser tab instead of
Python, about 1 week. Not needed for a first version: other pose models. RTMPose and ViTPose
are 2D only and their training sets would need checking one by one; MediaPipe does the job
under Apache-2.0.

## (b) Open text-to-motion as a Python sidecar

### What was checked

MoMask, MDM, T2M-GPT and MotionGPT all publish their code under MIT or Apache-2.0, and all
four publish only checkpoints trained on HumanML3D (or KIT-ML). HumanML3D's motions are
rebuilt from AMASS, whose licence is non-commercial research only and forbids training
networks for commercial use and sharing the data in any form. None of the four states a
licence for its checkpoints apart from the code's (MotionGPT's card says only "cc").

Size is not the obstacle. These models are small next to the chat models: MoMask's authors
run their demo on a CPU, and the MotionGPT checkpoint is 1.33 GB. MoMask's generation
script writes joint positions on HumanML3D's 22-joint SMPL skeleton and a BVH file without
the SMPL body model (SMPL is needed only for mesh rendering). Those 22 joints map onto the
clip joints with the same direction mapping as (a), plus the clavicles and neck. A sidecar
would follow `docs/carbon-x.md`: a separate process on 127.0.0.1 only, a pinned local
snapshot, no network at run time, safe error messages.

No model was run: with the licence as it is, a run would not change the verdict.

### Privacy design

A text prompt is the only input, and it stays on the machine like any chat message to a
local model. The output is a generated clip, not the person's data. If the prompt or the
clip is ever stored with the person's records, the consent and deletion rules of (a)
apply.

### Verdict: No-go for the published checkpoints; Go with conditions for a CMU-only retrain

No-go for shipping, downloading or recommending any of the published checkpoints: their
training data carries non-commercial terms that TwinLLM's licence would not show, and
weights derived from AMASS cannot be redistributed. A researcher can still run MoMask on
their own machine under AMASS's terms; TwinLLM should not do it for them.

Go with conditions for a later issue: train a MoMask-class model only on the CMU Motion
Capture Database, taken from CMU's own files and not from AMASS, paired with HumanML3D's MIT
text descriptions of the CMU clips. Conditions: the CMU terms confirmed on CMU's site, the
pairing rebuilt from the raw CMU files (HumanML3D cuts and resamples AMASS's versions, so
frame ranges need mapping), and quality checked on held-out prompts before anything is
shown. Effort: about 1 week to rebuild the pairs, 2 to 3 days of training on the 2080 Ti
when it is free, and about 1 week for the sidecar, the retargeting and the view. CMU is a
fraction of HumanML3D, so expect a narrower range of motions than the published models.

## Reproduce

The proof ran in `/home/mia/Projects/twin-llm-gait-spike`, outside the repository: a copy of
`python/motion/`, `render_walk.py` (the synthetic render) and `spike_eval.py` (pose, angles,
comparison, frame image). The sample video, the rendered video, the model, landmarks, CSVs
and images stay there and are not committed. SHA-256 of the treadmill clip:
`f06a3b0d9eb258d6f47170ffc08b456e340731753f936af23e20780618767d1f`.
