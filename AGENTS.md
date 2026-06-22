# Agent Guide

This project is a Vite + Three.js local pose-transfer prototype. It tracks MediaPipe
Holistic face/body landmarks from webcam or uploaded video and drives procedural and
GLB body rigs from a shared model gallery.

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

**Live site:** https://amitphillaura.github.io/3d-avatar/

## Important Files

- `src/app.js` — MediaPipe pipeline, camera/video handling, keypoint tables, JSON export.
- `src/avatar.js` — procedural Mushy rig and reusable `OneEuro` filter.
- `src/glbAvatar.js` — `CharacterAvatar`: GLB loader, pose retargeting, animation clips.
- `src/modelGallery.js` — body/face model card UI; drives all loaded rigs from one pose.
- `src/modelRegistry.js` — loads `registry.json` and probes which GLB files exist.
- `public/models/registry.json` — catalog of body/face model slots.
- `public/models/body/` — drop Meshy/custom body GLBs here (**gitignored**).
- `public/models/face/` — drop face GLBs here (**gitignored**).
- `public/models/character.glb` — bundled Mixamo Xbot (committed).
- `index.html` — full-width media stage + Live Keypoints & Models inspector.
- `public/mediapipe/` — vendored MediaPipe Holistic runtime.
- `HANDOFF.md`, `TODO.md` — handoff context and open work.

## Adding a body model (Meshy workflow)

1. In Meshy: rig character, add animations, download **GLB → All animations → single file**.
2. Save as e.g. `public/models/body/meshy-01.glb` (filename must match `registry.json`).
3. Optionally add a slot in `public/models/registry.json` under `body`.
4. In the app, click **Refresh Models** (or reload). Card shows **Ready** + animation list.
5. All loaded body models mirror your pose; click a card to set `window.__avatar` primary.

User GLBs under `body/` and `face/` are **not committed** (see `.gitignore`).

## Current Runtime Notes

- MediaPipe is local under `public/mediapipe` (no CDN).
- Camera uses native `getUserMedia` + `requestAnimationFrame` (not `camera_utils`).
- `modelComplexity` is `1` → requires `pose_landmark_full.tflite`.
- 3D Character `CAL`: `{ sx: 1, sy: -1, sz: -0.4, swapLR: false }`.
- Dev hooks: `window.__avatar`, `window.__modelGallery`, `window.__loadVideoURL`,
  `window.__playVideo`, `window.__processFrame`, `window.__video`.

## Verification Checklist

- `npm run build` passes.
- `npm audit --audit-level=low` reports 0 vulnerabilities.
- App loads without a browser alert.
- Body model gallery shows Mushy + Xbot; Meshy slots show **Awaiting file** until GLB added.
- **Refresh Models** rescans after dropping a file in `public/models/body/`.
- Live Keypoints panel + JSON export still work.
- Check ~390 px viewport after UI changes.

## Deployment

**Provider:** GitHub Pages  
**Repository:** [amitphillaura/3d-avatar](https://github.com/amitphillaura/3d-avatar)  
**URL:** https://amitphillaura.github.io/3d-avatar/  
**Secrets:** none  
**Deploy:** push to `main` → `.github/workflows/deploy.yml` (`BASE_PATH=/3d-avatar/`)

```bash
npm run build
npm run preview -- --host 127.0.0.1 --port 5180
gh workflow run deploy.yml   # manual re-deploy
```

## Constraints

- Keep the keypoint panel and JSON export.
- Do not remove local MediaPipe assets without a replacement strategy.
- Do not commit `public/sample.mp4` or user GLBs in `public/models/body/` / `face/`.
- Keep `npm run build` green and audit clean; verify in a real browser.
