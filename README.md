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

## Docs

`AGENTS.md` · `HANDOFF.md` · `TODO.md`
