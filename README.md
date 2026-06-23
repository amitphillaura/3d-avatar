# Live Pose Tester

Local camera/video/photo tester for MediaPipe keypoints and live 3D avatars. **Production runs on
this machine only** — not on GitHub Pages.

## Run

```bash
npm install
npm run dev              # http://127.0.0.1:5173/
npm run start            # manual prod → http://127.0.0.1:5180/
npm run autostart:install   # auto-start on login (macOS)
```

## Git

Code: https://github.com/amitphillaura/3d-avatar (no hosted app — CI builds only).

## Adding models

Drop rigged GLBs in `public/models/body/`, register in `registry.json`, click **Refresh Models**.

Camera access is opt-in: click **Start Camera** after the page loads, or use **Load Media**
with an image/video file.

## UI

The UI is tuned for a wide local display: a primary row of three big viewers — Raw
Camera/Video, Full Skeleton, and the Rigged Model — over a lower deck with the per-part
diagnostics laid out anatomically (head on top, body in the middle, hands on either side).
Landmark tables open as toggle popups via each tile's **Data** button. Strict no-scroll on
the wide display; it stacks and scrolls on smaller screens.

## Docs

`AGENTS.md` · `HANDOFF.md` · `TODO.md`
