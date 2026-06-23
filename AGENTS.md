# Agent Guide

This project is a Vite + Three.js local pose-transfer prototype. It tracks MediaPipe
Holistic face/body landmarks from webcam, uploaded video, or uploaded still images and drives procedural and
GLB body rigs from a shared model gallery.

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
- `src/avatar.js` — `MushyAvatar`, `OneEuro` filter, hero letterbox viewport, `frameBodyCamera`.
- `src/mushyModelAvatar.js` — GLB skinned on Mushy root; hero + gallery body cards use this.
- `src/poseSkeleton.js` — shared `mapPoseLandmark`, `MUSHY_HIP_Y` / `MUSHY_FOOT_Y`.
- `src/skeletonGraph.js` — pose connections, feet, neck bridge for 2D panes.
- `src/mixamoRig.js` — `MIXAMO_BONE_MAP`, `MESHY_BONE_MAP`, bone lookup.
- `src/modelGallery.js` — hero rig mount, body/face cards, primary model localStorage.
- `src/modelRegistry.js` — loads `registry.json`, body manifest scan, GLB availability probe.
- `src/glbAvatar.js` — legacy `CharacterAvatar`; **not used by hero gallery** (candidate to remove).
- `src/faceRig.js` — face landmark rig solver (2D/3D head; GLB face retarget TBD).
- `public/models/registry.json` — bundled models + `bodyOverrides` for Meshy filenames.
- `public/models/body/` — drop Meshy/custom body GLBs (**gitignored**); auto-scanned at build.
- `public/models/face/` — drop face GLBs here (**gitignored**).
- `public/models/character.glb` — bundled Mixamo Xbot (committed).
- `index.html` — sidebar + primary row (3 big viewers) + anatomical diagnostics + model dock.
- `public/mediapipe/` — vendored MediaPipe Holistic runtime.
- `HANDOFF.md`, `TODO.md` — handoff context and open work.

## Adding a body model (Meshy workflow)

1. In Meshy: rig character, add animations, download **GLB → All animations → single file**.
2. Save to `public/models/body/` with any filename (e.g. `my-hero.glb`).
3. Optionally add display name / rig / default clip in `public/models/registry.json` under `bodyOverrides` keyed by filename.
4. In the app, click **Refresh Models** (or reload). Every `.glb` in `body/` appears in the gallery and hero dropdown.

User GLBs under `body/` and `face/` are **not committed** (see `.gitignore`).

## Current Runtime Notes

- MediaPipe is local under `public/mediapipe` (no CDN).
- Camera uses native `getUserMedia` + `requestAnimationFrame`, but does not auto-start.
- Media file mode supports `video/*` playback, **frame scrubber** (30 fps), and one-frame `image/*`.
- `modelComplexity` is `1` → requires `pose_landmark_full.tflite`.
- Hero GLB pose = Mushy `mapPoseLandmark` points + bone `aimSegment` (not legacy CAL / `glbAvatar.js`).
- Meshy models hold **bind pose on load**; pick animation from dropdown to preview a clip.
- **Hero camera is fixed** (`frameBodyCameraFixed`) — a constant full-body frame, no per-frame follow.
- **Pause holds the last pose** (stale tracking ≠ reset). Bind/idle reset only on `clearTracking()`
  / `ModelGallery.resetTracking()` (explicit source switch / stop, via `resetDetection`).
- **Hands are rig-agnostic + wrist-only by default**; `findHandBone`/`buildHandEntries` scan the
  hand subtree. Sidebar **Track Fingers** toggle (`trackFingers`) opts into per-finger driving.
- Hero 3D letterboxes to `--viz-aspect`; the 3 primary viewers fill their grid cells.
- Dev hooks: `window.__avatar`, `window.__modelGallery`, `window.__loadVideoURL`,
  `window.__playVideo`, `window.__processFrame`, `window.__video`, `window.__image`.

## Verification Checklist

- `npm run build` passes.
- `npm audit --audit-level=low` reports 0 vulnerabilities.
- `npm run start` → http://127.0.0.1:5180/ loads and tracks.
- Body model gallery shows Mushy + bundled Xbot + scanned `body/*.glb` files.
- Hero **Rigged Model** column tracks with video; panels align in height and header row.
- Live keypoint tables + JSON export still work.

## Deployment

**Provider:** none (local machine only)  
**Production URL:** http://127.0.0.1:5180/  
**Command:** `npm run start` or **`npm run autostart:install`** (macOS login autostart)  
**Git remote:** https://github.com/amitphillaura/3d-avatar — code only; `.github/workflows/ci.yml` runs build + audit on push, no deploy.

## Constraints

- Keep the keypoint panel and JSON export.
- Do not remove local MediaPipe assets without a replacement strategy.
- Do not commit `public/sample.mp4` or user GLBs in `public/models/body/` / `face/`.
- Keep `npm run build` green and audit clean; verify in a real browser.
