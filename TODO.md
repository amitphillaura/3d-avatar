# TODO

## Done (recent)

- **Mushy-only rig** — removed GLB gallery, registry, Kalidokit path; hero is procedural Mushy only.
- **Full Skeleton joint labels** — shared `(F)` / `(B)` facing with Mushy rig labels.
- **Video frame scrubber** — 30 fps stepping for uploaded video.
- **Pause holds pose** — stale tracking freezes last pose instead of dropping to idle.
- **Hand L/R pairing** — nearest-wrist resolver in `src/handAssignment.js` (app, backend enrichment, no toggle).
- **Motion Library** — local API + UI; Holistic Tasks processor; matrix/segment workflow; API hardening.
- **Face-only rig** — head/neck from face landmarks without torso stub when body inactive.
- **Motion replay** — segment export drives hero rig + 2D panes (`/?replay=`, Play in Rig, Load Motion JSON).
- **Word search** — tags + phrase scoring + motion-shape heuristics (wave, bow, jump, dance, arm raise).

## Notes

- User sample video (`public/sample.mp4`) is gitignored — not in repo.
- MediaPipe assets live under `public/mediapipe/` (vendored, no CDN).
- Motion backend models download to `backend/models/` on first process run.
- Motion replay needs `npm run backend` or `npm run start:full` for `/?replay=<segment>` API loads.
