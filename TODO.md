# TODO

## Done (recent)

- **Mushy-only rig** — removed GLB gallery, registry, Kalidokit path; hero is procedural Mushy only.
- **Full Skeleton joint labels** — shared `(F)` / `(B)` facing with Mushy rig labels.
- **Video frame scrubber** — 30 fps stepping for uploaded video.
- **Pause holds pose** — stale tracking freezes last pose instead of dropping to idle.

## Open

- **Face rig polish** — refine Mushy head/neck from face landmarks when body is inactive.
- **Hand panel pairing** — nearest-wrist bridge in Full Skeleton; verify with varied poses.
- **Performance** — profile Holistic on long video sessions; consider frame skip when paused.

## Notes

- User sample video (`public/sample.mp4`) is gitignored — not in repo.
- MediaPipe assets live under `public/mediapipe/` (vendored, no CDN).
