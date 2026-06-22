# Agent Guide

This project is a Vite + Three.js local pose-transfer prototype. It tracks MediaPipe
Holistic face/body landmarks from webcam or uploaded video and drives either the
procedural Mushy rig or a GLB character rig.

## First Steps

```bash
cd "/Users/amit/Projects/3d Avatar"
npm install
npm run dev -- --port 5173
npm run build
npm audit --audit-level=low
```

Use `http://127.0.0.1:5173/` or the URL Vite prints. Webcam access requires localhost or
HTTPS. If the browser denies camera permission, switch to Video File mode to verify the
UI and avatar paths.

## Important Files

- `src/app.js` - app orchestration, MediaPipe pipeline, camera/video handling, keypoint
  tables, export hooks, and avatar style switching.
- `src/avatar.js` - procedural Mushy avatar and the reusable `OneEuro` smoothing filter.
- `src/glbAvatar.js` - GLB character loader and MediaPipe pose retargeting.
- `src/styles.css` - responsive dark UI styles.
- `index.html` - app shell and local MediaPipe script tags.
- `public/mediapipe` - vendored MediaPipe runtime files used by Holistic.
- `public/models/character.glb` - rigged character model.
- `references/` and `outputs/` - visual references and generated avatar concepts.
- `TODO.md` - current open calibration task.
- `HANDOFF.md` - detailed context and verification notes.

## Current Runtime Notes

- MediaPipe scripts and Holistic assets are served locally from `public/mediapipe`.
- The app no longer uses MediaPipe `camera_utils`; camera capture uses native
  `navigator.mediaDevices.getUserMedia` plus a `requestAnimationFrame` processing loop.
- `modelComplexity` is currently `1`, so `public/mediapipe/holistic/pose_landmark_full.tflite`
  is the required pose model file.
- 3D Character `CAL` is `{ sx: 1, sy: -1, sz: -0.4, swapLR: false }` — image-left maps to
  screen-left, matching the skeleton preview.
- The app exposes dev hooks on `window.__avatar`, `window.__loadVideoURL`,
  `window.__playVideo`, `window.__processFrame`, and `window.__video` for calibration.

## Verification Checklist

- `npm run build` passes.
- `npm audit --audit-level=low` reports 0 vulnerabilities.
- App loads without a browser alert.
- Camera-denied state is handled in the status panel.
- Video File mode updates the canvas placeholder and controls.
- 3D Character mode loads `public/models/character.glb`.
- Check one narrow viewport around 390 px wide after UI changes.

## Deployment

There is no remote or hosted deployment provider configured in this repository. The
current production deployment check is:

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 5180
```

If a future agent adds hosted deployment, document the provider, project name, URL,
required secrets, and deploy command here and in `HANDOFF.md`.

## Constraints

- Keep the keypoint panel and JSON export.
- Do not remove the local MediaPipe assets unless replacing them with a reliable bundled
  or hosted deployment strategy.
- Avoid committing `public/sample.mp4`; it is intentionally gitignored.
- Keep changes scoped and verify in a real browser, not only with the build.
