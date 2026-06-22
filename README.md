# Live Pose Tester

A local camera/video tester for MediaPipe face/body keypoints, neon motion trails, and
live 3D avatars. Built as a debugging surface for pose-transfer and Meshy character work.

**Live:** https://amitphillaura.github.io/3d-avatar/

## Run

```bash
npm install
npm run dev
```

Open the localhost URL Vite prints. Webcam needs localhost or HTTPS.

## Build / deploy

```bash
npm run build
npm run preview -- --port 5180
```

Pushes to `main` auto-deploy to GitHub Pages via `.github/workflows/deploy.yml`.

## Adding 3D models

1. Export a **rigged GLB** from Meshy (all animations in one file).
2. Place it in `public/models/body/` (e.g. `meshy-01.glb`).
3. Register the slot in `public/models/registry.json` if needed.
4. Click **Refresh Models** in the app.

User exports in `public/models/body/` and `public/models/face/` are gitignored and stay local.

## Features

- Face, body, or combined Holistic tracking
- Camera or uploaded video source
- Neon glow or clean skeleton overlay on the media canvas
- **Live Keypoints & Models** — body/face skeleton previews, tables, JSON export
- **Body model gallery** — Mushy + multiple GLB characters in a row (pose-synced)
- Per-model **animation** dropdown when not live-tracking
- Responsive layout

## Docs

- `AGENTS.md` — agent quick-start
- `HANDOFF.md` — full project context
- `TODO.md` — open tasks
