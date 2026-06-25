# Agent Guide

This project is a Vite + Three.js local pose-transfer prototype. It tracks MediaPipe
Holistic face/body landmarks from webcam, uploaded video, or uploaded still images and
drives the procedural **Mushy Rig**.

**Production runs on this machine only** — not hosted. GitHub stores the repo code; CI
builds on push but does not deploy anywhere.

## First Steps

```bash
cd "/Users/amit/Projects/3d Avatar"
npm install
npm run dev -- --port 5173          # development
npm run start                       # manual: build + serve on :5180
npm run autostart:install           # login autostart (macOS launchd)
npm run build
npm audit --audit-level=low
```

| Mode | URL |
|------|-----|
| Dev | http://127.0.0.1:5173/ |
| **Local prod** | http://127.0.0.1:5180/ |

Webcam needs localhost or HTTPS and is opt-in via **Start Camera**. If camera is denied,
use the media file picker with a video or image.

## Important Files

- `src/app.js` — MediaPipe pipeline, 2D skeleton panes, video frame scrubber, layout sync, JSON export.
- `src/avatar.js` — `MushyAvatar`, `OneEuro` filter, hero letterbox viewport, joint labels.
- `src/avatar<Name>.js` — character **variants** (clones of `avatar.js`): Kid, Prime, Ghost, Astro,
  Dragon, Neon, Slime, Shade, Bloom, Wurm, Cog, Voxel, Gem, Trail, Fuzz, Aqua, Ember, Nimbus,
  Pix, Jack, Star. Selectable via the rig dropdown. **To add more, follow
  [`RIG_VARIANTS_PLAYBOOK.md`](RIG_VARIANTS_PLAYBOOK.md) — a complete step-by-step recipe.**
- `src/rigHost.js` — mounts hero Mushy viewer and forwards tracking; holds the `RIG_VARIANTS` registry.
- `src/poseSkeleton.js` — shared `mapPoseLandmark`, framing constants.
- `src/skeletonGraph.js` — pose connections, feet, neck bridge for 2D panes.
- `src/jointLabels.js` — shared joint label text + facing helpers.
- `src/faceRig.js` — face landmark rig solver for Mushy head.
- `index.html` — sidebar + primary row (Raw, Full Skeleton, Mushy Rig) + anatomical diagnostics.
- `public/mediapipe/` — vendored MediaPipe Holistic runtime.
- `HANDOFF.md`, `TODO.md` — handoff context and open work.

## Current Runtime Notes

- MediaPipe is local under `public/mediapipe` (no CDN).
- Camera uses native `getUserMedia` + `requestAnimationFrame`, but does not auto-start.
- Media file mode supports `video/*` playback, **frame scrubber** (30 fps), and one-frame `image/*`.
- `modelComplexity` is `1` → requires `pose_landmark_full.tflite`.
- **Hero camera is fixed** (`frameBodyCameraFixed`) — a constant full-body frame, no per-frame follow.
- **Pause holds the last pose** (stale tracking ≠ reset). Reset only on explicit `clearTracking()` /
  `resetDetection()` (source switch / stop).
- Sidebar **Track Fingers** toggle (`trackFingers`) opts into per-finger driving on Mushy hands.
- Hero 3D letterboxes to `--viz-aspect`; the 3 primary viewers fill their grid cells.
- Dev hooks: `window.__avatar`, `window.__rigHost`, `window.__loadVideoURL`,
  `window.__playVideo`, `window.__processFrame`, `window.__video`, `window.__image`.

## Verification Checklist

- `npm run build` passes.
- `npm audit --audit-level=low` reports 0 vulnerabilities.
- `npm run start` → http://127.0.0.1:5180/ loads and tracks.
- Hero **Mushy Rig** column tracks with video; panels align in height and header row.
- Live keypoint tables + JSON export still work.

## Deployment

**Provider:** none (local machine only)  
**Production URL:** http://127.0.0.1:5180/  
**Command:** `npm run start` or **`npm run autostart:install`** (macOS login autostart)  
**Git remote:** https://github.com/amitphillaura/3d-avatar — code only; `.github/workflows/ci.yml` runs build + audit on push, no deploy.

## Constraints

- Keep the keypoint panel and JSON export.
- Do not remove local MediaPipe assets without a replacement strategy.
- Do not commit `public/sample.mp4`.
- Keep `npm run build` green and audit clean; verify in a real browser.
