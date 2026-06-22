# Handoff — Live Pose Tester ("3d Avatar")

For the next agent/engineer picking this up. Read this first, then `TODO.md`.

## Where it lives

- **Project root:** `/Users/amit/Projects/3d Avatar`
- **Git:** https://github.com/amitphillaura/3d-avatar — branch `main` (code only, no hosting)
- **Production:** **this machine** — http://127.0.0.1:5180/ via `npm run start`
- **Platform:** macOS. Node + Vite project.

## What it is

A Vite web app — a local **pose-transfer prototype**. MediaPipe Holistic tracks body +
face from **webcam or video file** and drives **multiple 3D body rigs** in a horizontal
model gallery below the keypoint inspector.

## Run it

```bash
cd "/Users/amit/Projects/3d Avatar"
npm install
npm run dev -- --port 5173     # development → http://127.0.0.1:5173/
npm run start                  # local production → http://127.0.0.1:5180/
npm run build
npm audit --audit-level=low
```

## Deployment

| Item | Value |
|------|--------|
| Hosted deploy | **None** — user wants prod on this Mac only |
| Local prod URL | http://127.0.0.1:5180/ |
| Local prod command | `npm run start` |
| GitHub | Repo + CI only (`.github/workflows/ci.yml` — build + audit, no Pages) |

Do **not** re-enable GitHub Pages unless the user asks.

## UI layout

1. **Top** — controls + full-width media canvas.
2. **Live Keypoints & Models** — body/face skeletons, tables, horizontal model gallery.

## Model library

```
public/models/
  registry.json
  character.glb       # bundled Xbot
  body/               # Meshy exports (gitignored *.glb)
  face/               # face GLBs (gitignored)
```

See `AGENTS.md` for Meshy drop workflow.

## Key files

- `src/app.js`, `src/modelGallery.js`, `src/glbAvatar.js`, `src/avatar.js`
- `public/mediapipe/`, `public/models/registry.json`

## Dev hooks

`window.__avatar`, `window.__modelGallery`, `window.__loadVideoURL`, `window.__playVideo`,
`window.__processFrame`, `window.__video`

## Conventions

- Keep keypoint panel + JSON export.
- Do not commit user GLBs in `body/` or `face/`.
- Keep build green and audit clean.
