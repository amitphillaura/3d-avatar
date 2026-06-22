# Handoff — Live Pose Tester ("3d Avatar")

For the next agent/engineer picking this up. Read this first, then `TODO.md`.

## Where it lives
- **Project root:** `/Users/amit/Projects/3d Avatar`
- **Git:** local repo, branch `main`, no remote configured yet.
- **Platform:** macOS. Node + Vite project.

## What it is
A Vite web app — a local **pose-transfer prototype**. It uses **MediaPipe Holistic**
(served from local files under `public/mediapipe`) to track body + face landmarks from a
**webcam or an uploaded video file**, and drives a live **Three.js 3D avatar** from the pose.

Bigger goal (the user's intent): build/use 3D characters that can be **driven by webcam or
video** — ultimately to swap characters into frames/movies. This app is the capture +
retargeting front end.

## Run it
```bash
cd "/Users/amit/Projects/3d Avatar"
npm install          # if node_modules missing
npm run dev -- --port 5173
# open http://127.0.0.1:5173/   (webcam needs localhost or HTTPS)
npm run build        # production build (must stay green)
npm audit --audit-level=low   # currently 0 vulnerabilities
npm run preview -- --port 5180 # local production preview/deployment check
```

There is currently **no git remote and no hosted deployment provider configured**. A hosted
deploy will need a target such as GitHub Pages, Vercel, Netlify, Cloudflare Pages, etc.

## Key files
- `AGENTS.md` — quick-start instructions for Cursor/Codex/Claude-style agents.
- `index.html` — layout, local MediaPipe scripts, control strip, two stage panels
  (camera + rig), and the Live Keypoints section.
- `src/app.js` — capture pipeline, drawing, video/camera handling, keypoint tables +
  skeleton previews, JSON export. Contains dev hooks on `window.__*` (see below).
- `src/avatar.js` — `MushyAvatar`, the procedural rig. Exports a reusable `OneEuro` filter.
- `src/glbAvatar.js` — `CharacterAvatar`: loads a Mixamo-rigged GLB and **retargets**
  MediaPipe pose → bone rotations. This is where the open calibration work is.
- `src/styles.css` — all styling (dark neon theme).
- `public/mediapipe/` — vendored MediaPipe scripts, wasm/data assets, and full pose
  model. This avoids CDN startup failures.
- `public/models/character.glb` — Mixamo "Xbot" rig (committed). Bone names lost their
  colons via GLTFLoader → use `mixamorigLeftArm`, not `mixamorig:LeftArm`.
- `public/sample.mp4` — Pexels dance clip for calibration. **Gitignored** (re-download if
  missing; any full-body clip works).
- `TODO.md` — the one unfinished task (read it).

## Current feature state
- ✅ Camera mode + Video File mode (MediaPipe runs on both).
- ✅ Camera permission denial is handled inside the app without a blocking browser alert.
- ✅ MediaPipe runtime is local instead of CDN-dependent.
- ✅ Mushy rig: One-Euro smoothing, neck/hands/feet, head tilt, visibility holding.
- ✅ 3D Character: GLB loads, 8 bones bound, depth-damped, per-bone visibility gating.
  Retargeting **engine is verified correct** (bone actual direction == target).
- ✅ Avatar style selector (Mushy / 3D Character) in the rig panel header.
- ✅ Live Keypoints: Body + Face tables side by side, each with a live skeleton preview,
  below the camera + rig screens. Clean Skeleton is the default visual style.

## The one open task (see TODO.md)
~~3D Character orientation mapping~~ — **done**. Baked `CAL` is
`{ sx: 1, sy: -1, sz: -0.4, swapLR: false }` so image-left matches screen-left
(aligned with the skeleton preview). Dev hook: `window.__avatar.cal = { sx, sy, sz, swapLR }`.

## Verifying changes (important)
Drive a real browser at http://127.0.0.1:5173/ with the webcam or a video file. If camera
permission is denied in the automation browser, verify that the app shows a handled camera
error, then switch to Video File mode and 3D Character mode. The continuous rAF render loop
can make idle-wait checks time out, so prefer direct DOM/screenshot checks and deterministic
video input for repeatable comparisons.

Baseline checks used most recently:
- `npm run build`
- `npm audit --audit-level=low`
- Browser smoke at `http://127.0.0.1:5180/`
- Desktop first screen, Video File mode, 3D Character load, and 390 px mobile viewport

## Conventions
- Match existing code style; avoid unrelated rewrites.
- Do **not** remove the keypoint panel/JSON export.
- Keep `npm run build` green and audit clean.
