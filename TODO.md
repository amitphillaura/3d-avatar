# TODO

## ✅ Done (recent session)

- **Mushy-driven GLB hero** — `MushyModelAvatar` replaces `CharacterAvatar` on hero + body
  gallery cards; pose = same `this.points` as Mushy cylinders (`aimSegment` on bones).
- **Shared pose mapping** — `poseSkeleton.js` + `skeletonGraph.js`; no separate CAL for hero.
- **Full Skeleton pane** — combined body, neck bridge, feet, face, hands in column 2.
- **Feet in rig** — heel/toe landmarks (29–32) in skeleton graph + Mushy foot segments.
- **Analysis grid layout** — 7-column top row, sidebar controls, bottom model dock.
- **Panel alignment** — `--viz-player-height` sync; unified tile header min-height (Rigged
  Model picker height).
- **Hero 3D viewport** — letterbox to `--viz-aspect`; `frameBodyCamera` / `frameCameraToPoints`.
- **Idle model fix** — no auto-play Meshy walk clip on load; bind pose until track or user anim.
- **Model vertical fit** — `fitModelToSkeleton()` aligns hips to `MUSHY_HIP_Y`.
- **Video frame scrubber** — FRAME slider (30 fps), preview while dragging, play on release.
- **Body model scan** — `scripts/scan-body-models.js` + vite plugin → `body/manifest.json`.
- **Registry bodyOverrides** — metadata for Meshy filenames without listing every slot.

## ✅ Done (rigged model rebuild)

- **Fixed hero camera** (`frameBodyCameraFixed`) — constant full-body frame; no more zoom drift,
  stays in frame when paused. (Replaced per-frame `frameCameraToPoints` follow.)
- **Pause = hold last pose** — stale tracking holds; bind reset only on explicit `clearTracking()`.
- **Rig-agnostic hands** — `findHandBone`/`buildHandEntries` scan the hand subtree (Mixamo/Meshy/…);
  wrist-only default + **Track Fingers** toggle with slerp damping.
- **Head bone** — removed the cross-space quaternion copy; head follows the neck.
- **Bigger viewers** — 3-up primary row; anatomical diagnostics; tables as toggle popups.

## Open — rig / retarget

- **Per-finger fidelity** — fingers (Track Fingers on) still rely on noisy Holistic hand data;
  consider confidence gating / heavier smoothing, or the rest-orientation idea from `retarget_bvh`.
- **Verify Meshy exports** — confirm `findHandBone` resolves real Meshy hand/finger names on
  Gray Bodysuit / Violet Vanguard (Meshy GLBs are gitignored — not in repo).
- **Head look (optional)** — drive the GLB head bone toward the nose in a space-correct way
  (currently follows the neck only).
- **Archive `glbAvatar.js`** — dead code in runtime bundle; delete or move to `archive/` when safe.

## Open — UX / media

- **Play video / Photos library** — broader codec/container testing on user exports.
- **Keyboard shortcuts** — space = play/pause, arrow keys = step frames (nice-to-have).

## Open — models

- **Face retargeting** — face row still static GLB preview; wire `faceRig.js` to a head model.
- **Face model slot** — `public/models/face/` GLBs when rigged exports exist.
- **Meshy bone naming** — `MESHY_BONE_MAP` in `mixamoRig.js`; confirm on each new export.

## Known constraints

- Production is **local only** (http://127.0.0.1:5180/); no GitHub Pages deploy.
- User GLBs under `body/` and `face/` are gitignored — not in repo.
- MediaPipe Holistic is vendored under `public/mediapipe/` — do not remove without replacement.
