# Live Pose Tester

A local camera/video tester for MediaPipe face/body keypoints, neon motion trails, and a live 3D avatar. It is intended as a quick debugging surface for 3D avatar and pose-transfer experiments.

## Run

```bash
npm install
npm run dev
```

Then open the localhost URL Vite prints in your browser. Webcam access requires localhost or HTTPS.

## Build / Preview

```bash
npm run build
npm run preview -- --port 5180
```

`npm run build` writes the production bundle to `dist/`. There is no hosted deployment
target configured in this repo yet; `npm run preview` is the current local production
deployment path.

## Agent Handoff

Start with `AGENTS.md`, then read `HANDOFF.md` and `TODO.md`. MediaPipe is vendored under
`public/mediapipe` so the app does not depend on CDN scripts at runtime.

## Features

- Face, body, or combined tracking modes
- Camera or uploaded video-file source
- Neon glow trails and clean skeleton styles
- Live Mushy AI 3D avatar viewport powered by Three.js
- Avatar body rig follows MediaPipe pose landmarks when you are visible in frame
- Avatar style switch: the procedural Mushy rig, or a rigged 3D character (GLB in
  `public/models/character.glb`) retargeted live from pose, with an idle clip when untracked
- Live compact JSON panel for key avatar landmarks
- Full keypoint JSON copy for downstream engine work
- Annotated snapshot download
- Responsive layout for smaller screens
