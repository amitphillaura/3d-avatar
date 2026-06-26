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
npm run backend:setup               # once: Python deps for Holistic processor
npm run backend                     # Motion API on http://127.0.0.1:5190
npm run dev -- --port 5173          # development (+ /api proxy)
npm run start                       # manual: build + serve on :5180
npm run start:full                  # build + backend + preview (Motion Library + prod UI)
npm run autostart:install           # login autostart (macOS launchd)
npm run build
npm run check:rig-registry
npm audit --audit-level=low
```

| Mode | URL |
|------|-----|
| Dev | http://127.0.0.1:5173/ |
| **Local prod** | http://127.0.0.1:5180/ |
| **Motion Library** | http://127.0.0.1:5180/motion.html (needs `npm run backend` or `npm run start:full`) |

Webcam needs localhost or HTTPS and is opt-in via **Start Camera**. If camera is denied,
use the media file picker with a video or image.

## Important Files

- `src/app.js` — MediaPipe pipeline, 2D skeleton panes, video frame scrubber, layout sync, JSON export.
- `src/avatar.js` — `MushyAvatar`, `OneEuro` filter, hero letterbox viewport, joint labels.
- `src/avatar<Name>.js` — 31 character **variants** (clones of `avatar.js`): Kid, Prime, Ghost,
  Astro, Dragon, Neon, Slime, Shade, Bloom, Wurm, Cog, Voxel, Gem, Trail, Fuzz, Aqua, Ember,
  Nimbus, Pix, Jack, Star, Knight, Mushroom, Octo, Bee, Magma, TV, Angel, Plush, Pirate, Skeleton.
  Selectable via the rig dropdown (32 characters incl. Mushy). **To add more, follow
  [`RIG_VARIANTS_PLAYBOOK.md`](RIG_VARIANTS_PLAYBOOK.md) — a complete step-by-step recipe.**
- `src/rigHost.js` — mounts hero Mushy viewer and forwards tracking; holds the `RIG_VARIANTS` registry (variants lazy-load via dynamic `import()`).
- `scripts/check-rig-registry.mjs` — CI check that registry keys, rig dropdown, and module files stay in sync (`npm run check:rig-registry`).
- `backend/` — Motion Library API (SQLite + Holistic batch processor + segment/matrix tagging). UI at `/motion.html`.
- `src/poseSkeleton.js` — shared `mapPoseLandmark`, framing constants.
- `src/skeletonGraph.js` — pose connections, feet, neck bridge for 2D panes.
- `src/jointLabels.js` — shared joint label text + facing helpers.
- `src/handAssignment.js` — shared nearest-wrist hand L/R resolver (app + Motion backend).
- `src/faceRig.js` — face landmark rig solver for Mushy head.
- Motion Library: `motion.html`, `src/motion.js`, `backend/` — import/process/tag segments (`npm run backend`, `/motion.html`).
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
- **Hand L/R** is resolved automatically via nearest-wrist pairing (no swap toggle).
- Hero 3D letterboxes to `--viz-aspect`; the 3 primary viewers fill their grid cells.
- **Rig variants lazy-load** — only the selected character chunk is fetched (~46 KB main bundle + per-variant chunk on demand).
- Dev hooks: `window.__avatar`, `window.__rigHost`, `window.__loadVideoURL`,
  `window.__playVideo`, `window.__processFrame`, `window.__video`, `window.__image`,
  `window.__motionReplay`, `window.__loadMotionSegment`.

## Verification Checklist

- `npm run check:rig-registry` passes.
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
