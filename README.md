# Live Pose Tester

Local camera/video tester for MediaPipe keypoints and live 3D avatars. **Production runs on
this machine only** — not on GitHub Pages.

## Run

```bash
npm install
npm run dev              # http://127.0.0.1:5173/
npm run start            # local prod → http://127.0.0.1:5180/
```

## Git

Code: https://github.com/amitphillaura/3d-avatar (no hosted app — CI builds only).

## Adding models

Drop rigged GLBs in `public/models/body/`, register in `registry.json`, click **Refresh Models**.

## Docs

`AGENTS.md` · `HANDOFF.md` · `TODO.md`
