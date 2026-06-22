# Handoff — Live Pose Tester ("3d Avatar")

For the next agent/engineer picking this up. Read this first, then `TODO.md`.

## Where it lives

- **Project root:** `/Users/amit/Projects/3d Avatar`
- **Git:** https://github.com/amitphillaura/3d-avatar — branch `main`
- **Live URL:** https://amitphillaura.github.io/3d-avatar/
- **Platform:** macOS. Node + Vite project.

## What it is

A Vite web app — a local **pose-transfer prototype**. MediaPipe Holistic tracks body +
face from **webcam or video file** and drives **multiple 3D body rigs** in a horizontal
model gallery below the keypoint inspector.

Goal: characters driven by webcam/video for pose-transfer and future frame/movie work.

## Run it

```bash
cd "/Users/amit/Projects/3d Avatar"
npm install
npm run dev -- --port 5173
npm run build
npm audit --audit-level=low
npm run preview -- --port 5180
```

## Deployment (GitHub Pages)

| Item | Value |
|------|--------|
| Repo | https://github.com/amitphillaura/3d-avatar |
| URL | https://amitphillaura.github.io/3d-avatar/ |
| Trigger | Push to `main` |
| Workflow | `.github/workflows/deploy.yml` |
| Secrets | None |

## UI layout (current)

1. **Top** — controls (source, tracking mode, visual style, export, **Refresh Models**).
2. **Stage** — full-width annotated camera/video canvas.
3. **Live Keypoints & Models**
   - **Body row** — skeleton preview + keypoint table + **horizontal model gallery**
     (Mushy, Xbot, Meshy slots from registry).
   - **Face row** — skeleton + table + face model slots (static GLB preview for now).

Click a model card to set the dev-hook primary (`window.__avatar`). All **loaded** body
GLBs receive the same live pose.

## Model library

```
public/models/
  registry.json       # catalog — edit to add/rename slots
  character.glb       # bundled Xbot (committed)
  body/               # user Meshy exports (gitignored *.glb)
    README.md
    meshy-01.glb      # example — you add this locally
  face/               # future face GLBs (gitignored *.glb)
    README.md
```

**Meshy export:** rig → add animations → download GLB (all clips, single file) → save to
`body/` matching `registry.json` → **Refresh Models** in the app.

**Code:** `src/modelRegistry.js` (fetch + HEAD probe), `src/modelGallery.js` (cards UI),
`src/glbAvatar.js` (`CharacterAvatar` — load URL, animation dropdown, Mixamo retargeting).

## Key files

- `src/app.js` — pipeline, `ModelGallery` init, dev hooks.
- `src/avatar.js` — Mushy procedural rig.
- `src/glbAvatar.js` — GLB retargeting; `CAL` baked for screen-left alignment.
- `src/modelGallery.js` / `src/modelRegistry.js` — model catalog UI.
- `public/mediapipe/` — vendored Holistic runtime.
- `public/models/character.glb` — Xbot; bones like `mixamorigLeftArm` (no colon).

## Feature state

- ✅ Camera + video file sources; permission denial handled in-app.
- ✅ Local MediaPipe (no CDN).
- ✅ Full-width media stage; models moved into keypoints inspector.
- ✅ Body model gallery: Mushy + registry GLBs side by side.
- ✅ Per-model animation clip dropdown (from embedded GLB clips).
- ✅ Orientation calibration done (`sx: 1`, `swapLR: false`).
- ✅ GitHub Pages deploy on push to `main`.
- ⏳ Face row: static GLB preview only (no face retarget yet).
- ⏳ Unified media toggle / photo input (see `TODO.md`).

## Dev hooks

```js
window.__avatar          // primary selected rig (click a card)
window.__modelGallery    // gallery controller
window.__loadVideoURL('/sample.mp4')
window.__playVideo()
window.__processFrame()
window.__video
window.__avatar.cal = { sx, sy, sz, swapLR }  // fine-tune GLB mapping
```

## Verifying changes

Use a real browser. After UI work, check desktop + ~390 px wide.

```bash
npm run build && npm audit --audit-level=low
```

On GitHub: Actions tab → **Deploy to GitHub Pages** should pass after push.

## Conventions

- Keep keypoint panel + JSON export.
- Do not commit user GLBs in `body/` or `face/` (gitignored).
- Keep build green and audit clean.
