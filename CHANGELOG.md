# Changelog

## Unreleased — review fixes & media improvements

### Fixed
- **Model gallery false-positive availability.** Missing Meshy/face GLBs were probed
  with a `HEAD` request that returned Vite's `index.html` (HTTP 200), so empty slots
  showed **Ready** and then threw `GLTFLoader` JSON parse errors. `probeModelFile` now
  rejects `text/html` responses and verifies GLB magic bytes (`glTF`).
- **Auto-camera race / unsolicited camera prompt.** The app no longer auto-requests the
  webcam ~800 ms after load. Camera is opt-in via the **Start Camera** button, which also
  removes the race that could override Video/Photo selection during startup.
- **Silent video failures.** Added a `video` `error` handler that surfaces decode/load
  failures (e.g. `DEMUXER_ERROR_*`) in the status bar instead of leaving a stale state.
- **Unsafe placeholder HTML.** Registry-sourced filenames are now rendered with
  `textContent` nodes instead of `innerHTML`.

### Added
- **Photo / image source.** The media picker accepts `image/*` and `video/*`. Images run a
  single-frame detection pass through the same MediaPipe pipeline. New dev hook
  `window.__loadImageURL(url, name)` and `window.__image`.

### Changed / Performance
- Offscreen model-card preview renderers pause via `IntersectionObserver`
  (`setPaused`) to save GPU when cards scroll out of view.
- Lighter neon glow stroke stack (thinner widths, lower blur, fewer retained trails).
- Three.js is split into `three` / `three-addons` vendor chunks for better caching;
  build output is warning-free.

### Docs
- Updated `README.md`, `AGENTS.md`, `HANDOFF.md`, and `TODO.md` for opt-in camera and the
  image/video media picker.

### Verification
- `npm run build` passes (clean output).
- `npm audit --audit-level=low` reports 0 vulnerabilities.
- Browser smoke (dev `:5174` and local prod `:5180`): camera idle on load, Start Camera
  works, Xbot ready, missing Meshy/face slots show **Awaiting file**, image mode tracks,
  and a corrupt video surfaces a clear error.
