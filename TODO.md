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

## Open — rig / retarget

- **Rigged zoom polish** — hero camera uses `spanScale: 0.68` on landmarks; may need per-model
  tuning so GLB fill matches Full Skeleton on all poses. Test Violet Vanguard + Gray Bodysuit.
- **Hands on GLB** — Mushy hand cylinders drive; finger bones mapped for Mixamo, verify Meshy exports.
- **Head/neck on GLB** — neck aims shoulder-mid → Mushy head; head bone copies Mushy head quat.
- **Archive `glbAvatar.js`** — dead code in runtime bundle; delete or move to `archive/` when safe.

## Open — UX / media

- **Visual target pass** — user reference screenshot at
  `/Users/amit/Downloads/504C8BFC-24F6-4935-B95B-32928B2D465D.PNG` (not yet fully matched).
- **Play video / Photos library** — broader codec/container testing on user exports.
- **Scrub while paused** — optional: release scrub without auto-play (user preference TBD).
- **Keyboard shortcuts** — space = play/pause, arrow keys = step frames (nice-to-have).

## Open — models

- **Face retargeting** — face row still static GLB preview; wire `faceRig.js` to a head model.
- **Face model slot** — `public/models/face/` GLBs when rigged exports exist.
- **Meshy bone naming** — `MESHY_BONE_MAP` in `mixamoRig.js`; confirm on each new export.

## Known constraints

- Production is **local only** (http://127.0.0.1:5180/); no GitHub Pages deploy.
- User GLBs under `body/` and `face/` are gitignored — not in repo.
- MediaPipe Holistic is vendored under `public/mediapipe/` — do not remove without replacement.
