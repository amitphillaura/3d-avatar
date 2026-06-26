# Changelog

## Unreleased — VRM Editor real VRMA animations

### Added
- **VRM Editor: authored `.vrma` playback.** Added `@pixiv/three-vrm-animation` and a real
  `THREE.AnimationMixer` path so animation buttons play authored motion clips instead of
  hand-coded pose guesses.
- **Floating animation panel.** The VRM viewport now has a bottom-left search panel with
  preset motion buttons, **Import .VRMA**, and **Stop** controls.
- **Local motion pack install.** Installed the official VRoid/BOOTH sample motions on this
  machine under `public/vrma/vroid/` and wired buttons for Show full body, Greeting, Peace
  sign, Shoot, Spin, Model pose, and Squat. The BOOTH binaries are local-only and ignored
  for GitHub redistribution.

### Fixed
- **Bad "wave" pose.** Removed the procedural wave preset that twisted the avatar and
  failed to move the hands correctly.
- **Rig dropdown registry sync.** Added the missing VRM Avatar and Dog entries to the main
  rig dropdown so the registry check is green again.

## Unreleased — Drive the VRM from a video

### Added
- **VRM Editor: "Drive from video…"** — animate the avatar from a video file, not
  just the live webcam. Both sources now share one pipeline
  (`<video>` → MediaPipe Holistic → Kalidokit → VRM bones); the video plays
  off-screen and loops. Monocular capture, so face/arms/hands track well and
  legs/depth are approximate. Bundled a default VRM (`public/vrm/default.vrm`) so
  there's a model to drive out of the box.
- **VRM Editor: motion record / replay / export / load** — record the driven
  bone rotations + expressions while capturing, then replay the performance on a
  loop (independent of the source), **export** it to a `vrm-motion` JSON file, or
  **load** a saved one back. Replay interpolates the recorded quaternions in the
  render loop.

## Unreleased — Site review fixes

### Fixed
- **VRM Editor "Load Default VRM" showed a cryptic error.** No default model is
  bundled, so `/vrm/default.vrm` returned the SPA's `index.html` and the loader
  threw `Unexpected token '<'`. `loadVrmFromUrl` now fetches and validates the
  bytes first (detects an HTML response) and shows a clear message: *"No model
  found there. Drag a .vrm file onto the viewport, or use Load File."*
- **Object Detection gave no clear signal when the backend was down.** A fetch
  failure now reads *"Detection backend offline — start it on :5190"* across
  live/video/multi modes, and the detect loops back off to 2s while offline
  instead of hammering the dead port ~10×/s.
- **Console deprecation warnings from the 3D viewport.** Replaced the deprecated
  `THREE.Clock` with a manual `performance.now()` frame delta, and
  `THREE.PCFSoftShadowMap` with `THREE.PCFShadowMap`.

### Changed
- **Media Lab** (Motion Capture) is an unimplemented placeholder — the tab now
  carries a "soon" badge and the panel reads "Coming soon …" instead of being
  presented as a finished feature.

## Unreleased — Object detection working & fast

### Fixed (Object Detection tool)
- **Camera live but no objects detected.** Three independent defects:
  - Detection routes were never registered in `backend/server.js`, so every
    `/api/detect/*` call returned `404`; the frontend silently drew nothing (a 404 body
    has no `detections`). Registered `registerDetectionRoutes` (and `registerAnimalRoutes`).
  - `runDetect()` wasn't awaited, so the route's `finally` deleted the temp frame before
    the Python worker could read it → empty results. Awaited at all three call sites.
  - The worker spawned system `python3` (no Ultralytics) instead of the project venv.
    Now resolves `backend/.venv/bin/python3` (with `DETECT_PYTHON` override), mirroring
    `lib/processor.js`.

### Changed (performance & quality)
- YOLO runs on the Apple GPU (**MPS**) / CUDA when available (CPU fallback), with a
  startup warm-up inference. Default model is now **`yolov8s`** (better recall);
  `DETECT_MODEL` env overrides.
- Frontend detect loop floor lowered `500ms → 100ms` (~2 fps → ~10 fps) and frames are
  downscaled to 640 px before sending (YOLO resizes to 640 internally). Measured ~24 fps
  full round-trip.
- `backend/README.md` documents the detection pipeline, routes, env config, and
  troubleshooting.

## Unreleased — Mushy-only (GLB removed)

### Removed
- **All GLB / skinned-model support** — deleted gallery, registry, body scan, Kalidokit
  driver, bundled Mixamo Xbot, and Meshy workflow docs. Hero viewer is **Mushy Rig only**
  via `src/rigHost.js`.

## Previous — Rigged Model fixes & big-viewer layout

### Fixed (Rigged Model panel)
- **Camera "zoomed all over."** The hero viewport re-fit the noisy landmark bounding
  box every frame. Replaced with a constant, deterministic full-body frame
  (`MushyAvatar.frameBodyCameraFixed`) over the fixed Mushy coordinate space, so the
  subject is always centered and in frame and the camera never jitters.
- **Character left frame / T-posed when paused.** The hero avatar now **holds its last
  pose** when tracking goes stale (paused video / brief dropout) instead of resetting to
  bind pose; the fixed camera keeps it framed. A true bind/idle reset happens only on an
  explicit clear (source switch / stop) via new `clearTracking()` /
  `ModelGallery.resetTracking()` (wired into `resetDetection`).
- **Hands "did weird stuff."** Finger bones were hardcoded to Mixamo names, so non-Mixamo
  (Meshy) rigs never resolved. Replaced with a **rig-agnostic** hand rig
  (`findHandBone` + `buildHandEntries`) that scans each hand bone's subtree and classifies
  finger bones by name (works for Mixamo, Meshy, Rigify, …). Hands are **wrist-only by
  default** (stable) with an opt-in **Track Fingers** toggle; fingers and wrist are
  slerp-damped to stop flipping.
- **Head faced the wrong way.** Removed a cross-coordinate-space quaternion copy onto the
  GLB head bone; the head now follows the neck.
- **Doubled media-button labels** (e.g. "Start Camera ▶ Start Camera"): `setMediaButtonLabel`
  now targets the real label text node, not the indentation whitespace.

### Changed (layout)
- **Three big viewers.** Replaced the cramped 7-column analysis grid with a primary row of
  three large players — Raw, Full Skeleton, Rigged Model — that fill the width (portrait
  sources letterbox tall). Strict no-scroll on the wide local display; stacks + scrolls below.
- **Anatomical diagnostics.** Body/Head/Hand previews are arranged like a body (head on top,
  body center, hands flanking) in a compact lower deck. Landmark tables moved into
  **toggle on/off popups** (per-part **Data** buttons, Escape to close) to free space.
- Removed now-dead camera/box helpers (`collectFramingPoints`, `frameCameraToPoints`,
  `getModelWorldBox`, `boxCornerPoints`) and dead `.analysis-grid` / `.table-card` CSS.

## Unreleased — review fixes & media improvements

### Current UI handoff
- **Four-column analysis grid.** The current uncommitted UI iteration is a 3440×1440
  no-scroll grid with four equal columns: Raw Camera/Video, Head, Body, and Hands.
- **In-column data.** Head, Body, and Hands tables now live inside their matching
  columns instead of a separate final Tables column.
- **In-column model cards.** Face model cards live in the Head column, Body model cards
  live in the Body column, and the Hands column has a placeholder for future hand model
  slots.
- **Equal player geometry.** Raw media, Head, Body, and Hands player/skeleton tiles share
  the same 16:9 tile sizing, while source media is still rendered with contain/letterbox
  aspect-ratio preservation.
- **Control semantics.** Camera is a Start/Stop button and video has a Loop toggle.

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
