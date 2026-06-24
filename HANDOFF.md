# Handoff — Live Pose Tester

Local-only pose/face tester: MediaPipe Holistic → 2D skeleton panes + procedural **Mushy Rig**.

**Prod URL:** http://127.0.0.1:5180/ (`npm run start` or `npm run autostart:install`)

## What works

1. **Raw video / image** — canvas output with optional skeleton overlay
2. **Full Skeleton** — combined body + face + hands 2D pane (optional joint labels)
3. **Mushy Rig** — procedural 3D cylinders driven from the same landmarks as Full Skeleton
4. **Diagnostics** — Head / Body / Left Hand / Right Hand tiles + JSON export

## Architecture

```
MediaPipe Holistic (local bundle)
  → app.js (2D panes, export, media controls)
  → rigHost.js → MushyAvatar (hero 3D viewer)
```

**Ground truth:** Mushy `mapPoseLandmark` + cylinder directions. Full Skeleton uses the same
landmark indices via `skeletonGraph.js`.

## Key files

| File | Role |
|------|------|
| `src/app.js` | Holistic loop, 2D drawing, layout sync, JSON export |
| `src/avatar.js` | MushyAvatar — joints, bones, hands, face head, joint labels |
| `src/rigHost.js` | Hero mount wrapper |
| `src/poseSkeleton.js` | Landmark → Mushy 3D space |
| `src/skeletonGraph.js` | 2D bone connections |
| `index.html` | Layout: sidebar + 3 hero viewers + diagnostic deck |

## Runtime notes

- Camera is opt-in (**Start Camera**); video/image via file picker.
- **Pause holds pose** on Mushy until explicit reset (source switch / stop).
- `window.__avatar` — hero Mushy instance; `window.__rigHost` — mount wrapper.
- Dev: `window.__loadVideoURL`, `window.__processFrame`, etc.

## Verify

```bash
npm run build && npm audit --audit-level=low
npm run start   # → http://127.0.0.1:5180/
```

Load a video or start camera; confirm Raw, Full Skeleton, and Mushy Rig stay aligned.

## Constraints

- Keep keypoint tables and JSON export.
- Do not remove vendored MediaPipe without a replacement plan.
- Do not commit `public/sample.mp4`.
