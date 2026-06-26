# Animal Motion Capture — Handoff

> **Purpose of this doc:** A self-contained brief so a fresh local Claude Code
> session (or you) can pick up and build animal motion capture into this
> project without re-discovering the architecture. Read top to bottom once,
> then jump to **Milestone 1**.

---

## 1. The Goal

Extend this project — which currently captures **human** motion and drives 32
procedural 3D characters — so it can capture **animal** motion (dog first) and
drive a procedural animal avatar. End state: feed a video of a dog walking,
get a 3D dog walking on screen, and eventually export that motion the same way
human segments are exported today.

Dog is the chosen first target because it has the best open-source
pose-estimation support and an obvious 4-legged rig.

---

## 2. How The Project Works Today (the parts that matter)

The key insight: **this project is landmark-driven and fully procedural.**
There is **no SMPL, no BVH, no skinned mesh, no bone hierarchy.** Every frame,
33 human landmarks from MediaPipe are mapped to 3D coordinates, and primitive
meshes (spheres for joints, cylinders for bones) are positioned directly at
those coordinates. That makes adding a new skeleton topology *much* easier
than in a rigged pipeline — there's no rig to fight.

### The canonical data flow

```
Video / webcam
   → MediaPipe Holistic (33 pose + 21×2 hand + 468 face landmarks)
   → poseSkeleton.js  mapPoseLandmark()  [the single source of truth mapping]
   → MushyAvatar positions spheres/cylinders at mapped coords every frame
   → Three.js renders
```

The *exact same* `mapPoseLandmark()` is reused in three places, which keeps all
views in sync:
- Frontend live rig (`src/avatar.js` + 31 variants)
- 2D skeleton overlay (`src/skeletonGraph.js`)
- Backend batch processor (`backend/lib/rig3d.js`)

### Files you must understand before touching anything

| File | Why it matters for animals |
|------|----------------------------|
| `src/poseSkeleton.js` | **The mapping.** `mapPoseLandmark()` converts MediaPipe's 0–1 normalized coords to 3D world space. You'll write an animal analog here. |
| `src/skeletonGraph.js` | Defines human topology: which 17 joints exist and which bones connect them. You'll write a dog topology. |
| `src/avatar.js` | Base `MushyAvatar` class (~1200 lines). Builds the rig, runs One-Euro smoothing, positions meshes. Your `avatarDog.js` will be modeled on this. |
| `src/rigHost.js` | `RIG_VARIANTS` registry + lazy-loads the selected variant. You register the dog here. |
| `backend/worker/process_video.py` | MediaPipe extraction in Python. You'll write a sibling that runs an animal pose model. |
| `backend/lib/rig3d.js` | Backend coordinate enrichment, mirrors the frontend mapping. |
| `RIG_VARIANTS_PLAYBOOK.md` | Existing 26 KB recipe for adding a new character. Read it — the dog is "just" a new variant with a different skeleton. |

### The mapping function (memorize the shape of this)

```js
// src/poseSkeleton.js — current human version
mapPoseLandmark(landmark):
  x: (0.5  - landmark.x) * 4.3
  y: (0.58 - landmark.y) * 4.8
  z: -0.65 - (landmark.z || 0) * 1.4
```

Input is normalized 0–1 image coords (origin top-left). Output is Three.js
world space. Your animal extractor must output landmarks in this **same 0–1
normalized format** so this mapping (or a close variant) just works.

### Smoothing

Per-axis, per-joint **One-Euro filter**. Defaults: `minCutoff 1.4, beta 0.012`;
z-axis tuned softer (`0.7 / 0.006`). Reuse as-is for animals.

---

## 3. Tool Choice (decided)

**Two-stage, top-down: object detector → animal pose.**

```
video frame → object detector ("dog" + bounding box) → crop → MMPose (pose in box)
```

This is not optional. AP-10K pose models are **top-down**: they don't find the
animal — you hand them a bounding box and they estimate the pose inside it. That
box comes from an **object detector** running first. (Same mechanism lets you
handle multiple subjects later: detect each, crop, pose each crop.)

**Stage 1 — Object detector (bounding box):**
- **MMDetection** (same OpenMMLab family as MMPose — cleanest pairing) or
  **YOLO / Ultralytics** (lighter, fast). Either gives "dog + box" per frame.
- Don't run it every frame for live use — detect periodically, track between.
  For batch/video processing, per-frame is fine.

**Stage 2 — Pose estimation: MMPose with its animal configs.**

Rationale vs. the alternatives:
- **MMPose** — has *pre-trained* animal models (AP-10K dataset, ~17 keypoints
  covering quadrupeds incl. dogs). Outputs keypoints directly, no per-video
  training. Best fit because we want "video in, dog out" with zero labeling.
- **DeepLabCut** — excellent but built around *training your own* model per
  setup. More work for a generic dog. Keep as fallback if MMPose accuracy is
  poor on your footage.
- **SLEAP** — strongest for multi-animal lab settings; overkill here.

**3D character: a new procedural `avatarDog.js`**, same primitive approach as
the 32 existing characters — just a quadruped topology.

**Optional later: SMAL** (Skinned Multi-Animal Linear model) if you want a
proper skinned mesh instead of primitives. Not needed for Milestone 1; it's a
bigger lift and breaks the "everything is procedural" simplicity.

---

## 4. The Animal Skeleton (AP-10K, 17 keypoints)

MMPose's AP-10K quadruped keypoint set — plan the dog topology around these:

```
0  nose          1  left eye       2  right eye
3  neck/withers  4  tail base/root
5  L shoulder    6  L elbow        7  L front paw
8  R shoulder    9  R elbow       10  R front paw
11 L hip        12 L knee         13 L hind paw
14 R hip        15 R knee         16 R hind paw
```

Bones to draw (the dog equivalent of the human `BONES` array):

```
nose–neck, neck–tailbase (spine), 
neck–Lshoulder, Lshoulder–Lelbow, Lelbow–Lfrontpaw,
neck–Rshoulder, Rshoulder–Relbow, Relbow–Rfrontpaw,
tailbase–Lhip, Lhip–Lknee, Lknee–Lhindpaw,
tailbase–Rhip, Rhip–Rknee, Rknee–Rhindpaw
```

(Confirm exact AP-10K index order against the MMPose docs when you wire it up —
index conventions occasionally differ between configs.)

---

## 5. Milestones

### Milestone 1 — Static dog pose end-to-end (smallest useful slice)
Prove the full path on a single image/short clip before polishing.

1. **Backend extractor** — new `backend/worker/process_video_animal.py`:
   - **Stage 1:** run the object detector (MMDetection or YOLO) per frame → get
     the animal's bounding box. If no animal is detected, mark the frame empty.
   - **Stage 2:** crop to the box and run MMPose AP-10K → 17 keypoints.
   - Convert keypoints back to **full-frame** normalized 0–1 coords (remember to
     un-crop: map box-relative pixels back into the whole image) and emit JSON
     per frame in the **same schema** the existing `process_video.py` produces.
   - Keep the output filename/format compatible with `processor.js` so the
     existing pipeline ingests it. (May need a `kind: "animal"` flag on the
     record.)
   - Tip: prove Stage 2 alone on a tight dog photo first (skip detection by
     using the whole image as the box), then add Stage 1 in front of it.
2. **Animal mapping** — add `mapAnimalLandmark()` to `src/poseSkeleton.js`
   (start by reusing the human constants; tune the multipliers once you see it).
3. **Dog topology** — new module (e.g. `src/dogSkeleton.js`) with the 17
   joints + bone list above, mirroring `skeletonGraph.js`.
4. **Dog avatar** — new `src/avatarDog.js` modeled on `avatar.js`: build 17
   joint spheres + the bone cylinders, reuse One-Euro smoothing, position from
   mapped landmarks. Start ugly (gray spheres + sticks). Don't style yet.
5. **Register** the dog in `src/rigHost.js` `RIG_VARIANTS` so the dropdown can
   select it.

**Definition of done:** select "Dog", feed a dog photo/clip, see a recognizable
3D dog skeleton posed correctly.

### Milestone 2 — Walking motion
- Run on a walking-dog video, confirm temporal smoothness, tune One-Euro and
  the mapping multipliers for the quadruped's proportions and depth.

### Milestone 3 — Export / motion library
- Make the backend matrix/segment path (`backend/lib/matrix.js`,
  segment export) animal-aware so dog motions can be tagged, searched, and
  replayed like human segments. The motion detectors (wave/bow/jump/dance) are
  human-specific — add quadruped equivalents (walk/trot/sit) or skip detection
  for now.

### Milestone 4 (optional) — Style + more species
- Make the dog look good (ears, snout, tail wag in `syncAttachedModel`).
- Generalize topology so cat/horse reuse the same AP-10K skeleton with
  different proportions.

---

## 6. Open Questions / Decisions To Make

- **Environment for MMPose:** it has heavier deps (PyTorch, mmcv) than the
  current MediaPipe setup. Decide: separate venv, Docker, or conda. Check the
  network policy allows the model-weight downloads.
- **Single mapping vs. separate:** can `mapAnimalLandmark` reuse the human
  multipliers, or does the quadruped's wider/lower body need its own constants?
  (Expect to retune `y` offset and `z` scale.)
- **Depth (z):** MediaPipe gives a depth estimate per landmark; AP-10K models
  are typically **2D only**. Decide how to fake/derive z (flat plane first,
  then per-joint heuristics, or a 3D animal model later).
- **Schema compatibility:** how much of `processor.js` / `rig3d.js` assumes
  exactly the human 33-landmark layout? Audit before extending.

---

## 7. Gotchas

- **Top-down needs a box.** AP-10K won't run without a detector first — Stage 1
  (detection) is a hard dependency, not an enhancement. No box → no pose.
- **Un-crop carefully.** Pose keypoints come out **relative to the crop**. You
  must transform them back to full-frame 0–1 coords before emitting, or the dog
  will be offset/scaled wrong. This is the most common silent bug in top-down
  pipelines.
- **Don't break the humans.** 32 existing characters depend on
  `mapPoseLandmark` and the 33-landmark schema. Add alongside; don't mutate the
  human path.
- **2D-only keypoints** means no real depth — the first dog will look flat from
  some angles. That's expected for Milestone 1.
- **Index order** for AP-10K must be verified against the actual MMPose config
  you load; a wrong order silently produces a scrambled skeleton.
- **Production is local-only** (`http://127.0.0.1:5180/`, backend `:5190`). No
  hosting assumptions.
- The backend Python worker is spawned via `spawn()` from `processor.js` — keep
  the new extractor's CLI signature and stdout/JSON contract consistent.

---

## 8. First Commands For The Local Session

```
# 1. Read the architecture the playbook documents
open RIG_VARIANTS_PLAYBOOK.md

# 2. Study the three files you'll mirror
src/poseSkeleton.js      # the mapping
src/skeletonGraph.js     # human topology → write dog analog
src/avatar.js            # base rig → write avatarDog.js

# 3. Stand up MMPose in an isolated env and confirm AP-10K
#    inference works on one dog image, printing 17 keypoints.

# 4. Then start Milestone 1, step 1 (the Python extractor).
```

Branch for this work: `claude/animal-motion-capture-2kath6`.
```
```

---

*Handoff prepared from a read-only exploration of the codebase. No code was
changed. The plan deliberately preserves the existing human pipeline and adds
the animal path alongside it.*
