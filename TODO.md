# TODO

## Done (recent)

- **Mushy-only rig** — removed GLB gallery, registry, Kalidokit path; hero is procedural Mushy only.
- **Full Skeleton joint labels** — shared `(F)` / `(B)` facing with Mushy rig labels.
- **Video frame scrubber** — 30 fps stepping for uploaded video.
- **Pause holds pose** — stale tracking freezes last pose instead of dropping to idle.
- **Hand L/R pairing** — nearest-wrist resolver in `src/handAssignment.js` (app, backend enrichment, no toggle).
- **Motion Library** — local API + UI; Holistic Tasks processor; matrix/segment workflow; API hardening (delete, limits, recovery).
- **Face-only rig** — head/neck from face landmarks without torso stub when body inactive.

## Open

- **Word search quality** — basic substring + vector score; richer embeddings later.
- **Motion ↔ live replay** — export JSON exists; rig playback from library segments not wired in hero viewer yet.

## Notes

- User sample video (`public/sample.mp4`) is gitignored — not in repo.
- MediaPipe assets live under `public/mediapipe/` (vendored, no CDN).
- Motion backend models download to `backend/models/` on first process run.
