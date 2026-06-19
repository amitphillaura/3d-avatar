# Handoff — Live Pose Tester ("3d Avatar")

For the next agent/engineer picking this up. Read this first, then `TODO.md`.

## Where it lives
- **Project root:** `/Users/amit/Documents/3d Avatar`
- **Git:** local repo, branch `main`, no remote configured yet. First commit already made.
- **Platform:** macOS. Node + Vite project.

## What it is
A Vite web app — a local **pose-transfer prototype**. It uses **MediaPipe Holistic**
(loaded via CDN `<script>` tags in `index.html`) to track body + face landmarks from a
**webcam or an uploaded video file**, and drives a live **Three.js 3D avatar** from the pose.

Bigger goal (the user's intent): build/use 3D characters that can be **driven by webcam or
video** — ultimately to swap characters into frames/movies. This app is the capture +
retargeting front end.

## Run it
```bash
cd "/Users/amit/Documents/3d Avatar"
npm install          # if node_modules missing
npm run dev -- --port 5173
# open http://127.0.0.1:5173/   (webcam needs localhost or HTTPS)
npm run build        # production build (must stay green)
npm audit --audit-level=low   # currently 0 vulnerabilities
```

## Key files
- `index.html` — layout, MediaPipe CDN scripts, control strip, two stage panels
  (camera + rig), and the Live Keypoints section.
- `src/app.js` — capture pipeline, drawing, video/camera handling, keypoint tables +
  skeleton previews, JSON export. Contains dev hooks on `window.__*` (see below).
- `src/avatar.js` — `MushyAvatar`, the procedural rig. Exports a reusable `OneEuro` filter.
- `src/glbAvatar.js` — `CharacterAvatar`: loads a Mixamo-rigged GLB and **retargets**
  MediaPipe pose → bone rotations. This is where the open calibration work is.
- `src/styles.css` — all styling (dark neon theme).
- `public/models/character.glb` — Mixamo "Xbot" rig (committed). Bone names lost their
  colons via GLTFLoader → use `mixamorigLeftArm`, not `mixamorig:LeftArm`.
- `public/sample.mp4` — Pexels dance clip for calibration. **Gitignored** (re-download if
  missing; any full-body clip works).
- `TODO.md` — the one unfinished task (read it).

## Current feature state
- ✅ Camera mode + Video File mode (MediaPipe runs on both).
- ✅ Mushy rig: One-Euro smoothing, neck/hands/feet, head tilt, visibility holding.
- ✅ 3D Character: GLB loads, 8 bones bound, depth-damped, per-bone visibility gating.
  Retargeting **engine is verified correct** (bone actual direction == target).
- ✅ Avatar style selector (Mushy / 3D Character) in the rig panel header.
- ✅ Live Keypoints: Body + Face tables side by side, each with a live skeleton preview,
  below the camera + rig screens. Clean Skeleton is the default visual style.

## The one open task (see TODO.md)
The 3D Character **orientation mapping is not finalized** — limbs appear mirrored/crossed.
Engine is fine; only the `CAL` sign/swap constants in `src/glbAvatar.js` need to be pinned
down empirically. A live tuning harness exists:
- `window.__avatar.cal = { sx, sy, sz, swapLR }` — tune without rebuilding.
- `window.__loadVideoURL('/sample.mp4')`, `window.__playVideo()`,
  `window.__processFrame()`, `window.__video` — drive the deterministic test clip.
Open question for the user: **mirror** (webcam-natural) vs **direct copy** (matches source).

## Verifying changes (important)
The user has the **Claude-in-Chrome** extension; the most reliable way to verify is to
drive the real browser at http://127.0.0.1:5173/ with the webcam or `sample.mp4`. Note:
the continuous rAF render loop makes `preview_eval`/idle-wait time out — use
`javascript_tool` + screenshots instead, and drive the deterministic video for repeatable
comparisons.

## Conventions
- Match existing code style; avoid unrelated rewrites.
- Do **not** remove the keypoint panel/JSON export.
- Keep `npm run build` green and audit clean.
