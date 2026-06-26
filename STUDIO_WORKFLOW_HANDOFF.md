# Studio Workflow — Build Plan & Handoff

> **Purpose:** Turn the current pile-of-pieces into one coherent studio app a
> person can work in quickly. Read top to bottom, then start at **Build Order →
> Phase 0**. Dog / quadruped support is explicitly **out of scope here** and
> comes in a later phase.

---

## 1. The Vision (what we're building toward)

A searchable **motion library**. Feed it video, keep the takes you like, label
them, and later — from a different app (the "Bowtie" chat) — pull a motion by
*describing* it ("someone walking") and replay it on whatever character you
choose. **Motion and character are decoupled.** The database is the source of
truth.

This handoff covers the **authoring/studio side** that fills and manages that
library. The Bowtie chat consumer is downstream and not built here.

---

## 2. The Shape: Home Hub → Tools

The app opens on a **Home splash** (a polished landing page) that routes into
each tool. This replaces "the app is a couple of disconnected pages" with one
front door.

```
┌───────────────────────────────────────────────────────────────┐
│  HOME  (splash / landing)                                     │
│                                                               │
│        ┌──────────────┐  ┌──────────────────┐                 │
│        │ Motion       │  │ Object           │   …more later   │
│        │ Capture  ▶   │  │ Detection   ▶    │  (VRM, Animals) │
│        └──────────────┘  └──────────────────┘                 │
└───────────────────────────────────────────────────────────────┘
        │                          │
        ▼                          ▼
   MOTION CAPTURE tool        OBJECT DETECTION tool
   (this document)            (OBJECT_DETECTION_HANDOFF.md)
```

### Motion Capture tool — Two Tabs + One Queue

```
┌───────────────────────────────────────────────────────────────┐
│  MOTION CAPTURE        [‹ Home]                               │
│  ┌─────────────┬──────────────┐        ┌────────────────────┐ │
│  │  ① INTAKE   │  ② MEDIA LAB │        │   QUEUE SIDEBAR    │ │
│  │  (new)      │  (saved DB)  │        │  (always visible)  │ │
│  └─────────────┴──────────────┘        │                    │ │
│                                         │  clip_A  ✓ Ready   │ │
│   Tab content area                      │  clip_B  ⟳ 45%     │ │
│                                         │  clip_C  • Queued  │ │
│                                         │  clip_D  ✗ Error ↻ │ │
│                                         └────────────────────┘ │
└───────────────────────────────────────────────────────────────┘
```

Every tool has a **‹ Home** affordance to get back to the hub. The queue sidebar
belongs to the Motion Capture tool (and any tool that enqueues jobs).

### Tab ① — Intake (new footage only)
- Pick a video from disk (defaults to **Downloads**, navigable/configurable)
- Play it; a character (Mushy/etc.) performs it live as a throwaway preview
- Like it → **Save**
- Save **physically moves** the file out of its source folder into the
  DB-managed store, renames it, registers it, and **auto-starts a background
  processing job** (you don't wait)
- Only ever shows footage that hasn't been accepted yet

### Tab ② — Media Lab (the saved collection)
- Browse everything in the database
- Replay any motion on any character
- **Label it** (tags / description / motion type / search prompt) — manual,
  plus **object-detection auto-tagging** (detected objects → searchable tags)
  and vision-LLM assistance later
- Build motion matrices, inspect, manage, delete
- Everything here has already been through Intake

### Queue Sidebar (persistent, both tabs)
- One row per job: `• Queued` → `⟳ Processing NN%` → `✓ Ready` (or `✗ Error ↻`)
- On **Ready**: highlight + toast so you notice even if you looked away
- **Click a Ready row → jumps to that item in the Media Lab**, ready to label
- `✗ Error` rows offer **Retry**; nothing fails silently

**The loop:** open from Downloads → play → like → Save → move on immediately →
sidebar ticks to Ready → click → label & replay in Media Lab.

---

## 3. What Already Exists vs. What's New

Most plumbing exists — the work is **coherence + three new capabilities**.

| Capability | State today | Action |
|------------|-------------|--------|
| Live video → character playback | ✅ in `src/app.js` (live tester) | Reuse as Intake preview |
| SQLite DB, segments, tags, matrices, search | ✅ backend | Reuse as-is |
| Motion replay engine | ✅ `src/motionReplay.js` | Reuse in Media Lab |
| Backend pose extraction (Python/MediaPipe) | ✅ `worker/process_video.py` | Reuse as the canonical extractor |
| `/media` folder picker | ✅ `src/mediaLibrary.js` | Pattern to build the file browser from |
| **Unified two-tab shell + queue sidebar** | ❌ split across `index.html` / `motion.html` | **New** |
| **Backend file browser (Downloads) + move-on-save** | ❌ today upload *copies* a buffer | **New** |
| **Job queue with live status** | ⚠️ only `video.status` flips; no progress/queue API | **New** |

---

## 4. Three Design Decisions (locked)

1. **"Words" = labels, not audio.** Manual text labeling now (tags, description,
   motion type, search prompt). A **vision-LLM auto-labeler** (sample frames →
   image-to-text → proposed tags) is a *later* Media-Lab action. No audio/speech
   pipeline. The existing `tags` / `description` / `motion_type` / `word_prompt`
   fields already hold this.

2. **Source = Downloads, user-selectable, true MOVE.** Because a browser file
   picker can't move files (it only gets a copy of the contents, never the real
   path), the **backend** performs the move by path. So we build a small
   **backend-driven file browser** rooted at Downloads (configurable), the user
   picks a file, and the backend `rename`s it into the managed store. Original
   is gone — that's intended.

3. **Save = move + auto background processing.** Save returns immediately; the
   job runs in the background and surfaces in the queue sidebar. Heavy/optional
   work (matrix build, labeling, future vision-LLM) stays in the Media Lab.
   *Not* block-until-done (kills the rhythm); *not* manual-process-later
   (accumulates unprocessed files).

---

## 5. Build Order

Ship each phase working before the next. Each is independently testable.

### Phase 0 — Home hub + unify the shell (no new backend)
- Build the **Home splash**: a polished landing page with cards/buttons routing
  into each tool (Motion Capture, Object Detection; more later). This is the new
  app entry point — make it look good, it's the front door.
- Add lightweight **client-side routing** (Home ↔ tool screens) with a `‹ Home`
  affordance in each tool.
- Fold the two existing HTML entry points into the **Motion Capture tool** as
  tabs (`① Intake` / `② Media Lab`) with a placeholder queue sidebar. Intake
  hosts the existing live video→character view; Media Lab hosts the existing
  motion library UI.
- **Goal:** open the app → see the splash → click into Motion Capture → both
  tabs work, nothing lost. (Object Detection card can route to a stub for now;
  it's built in its own handoff.)

### Phase 1 — Backend file browser
- New route `GET /api/files/browse?path=<dir>` → lists folders/video files under
  an **allowed root** (default Downloads; configurable). **Confine to the root —
  reject path traversal above it.**
- Intake tab gets a file-browser panel that drives it; selecting a file loads it
  into the preview player.
- **Goal:** open and play a Downloads video inside Intake.

### Phase 2 — Move-on-save
- New route `POST /api/videos/import-by-path { path }`:
  - Validate `path` is under the allowed root and is a video
  - Compute sha256; if already imported, **do not move** — tell the user it's a
    duplicate (leave their original alone)
  - **Move** into `data/videos/{id}/source.mp4` via `fs.rename`, with a
    **copy-then-unlink fallback** for cross-device moves (`EXDEV`)
  - Insert the `videos` row (`status = 'uploaded'`), then **enqueue processing**
- Wire the Intake **Save** button to this.
- **Goal:** Save moves the file and it disappears from Downloads.

### Phase 3 — Job queue + live status
- Add progress reporting: the Python worker emits `frames_done / frame_count`;
  surface via the DB (or an in-memory job map) behind `GET /api/queue` returning
  in-flight + recently-finished jobs (`queued | processing(NN%) | ready | error`).
- Queue sidebar polls (or SSE) and renders; **Ready → toast + click-to-jump**
  into the Media Lab detail; **Error → Retry** (re-enqueue).
- Decide concurrency (start: **one job at a time**, simplest and matches the
  existing `processing` Set).
- **Goal:** Save → watch it go Queued → Processing → Ready → click into Media Lab.

### Phase 4 — Media Lab labeling polish
- Make manual labeling fast: tags, description, motion type, search prompt,
  approve, delete; replay on a character selector; build matrix.
- Mostly refining `src/motion.js` into the tab.
- **Goal:** a clip can be fully labeled and replayed in well under a minute.

### Phase 5 — Object-detection auto-tagging (real feature, build & test)
- Run an object detector over saved clips and **store what it finds as
  searchable tags** — so motions are findable by scene contents ("holding a
  cup," "near a chair," "ball"), not just by body motion.
- **Use the detector's built-in classes out of the box** — the standard
  pre-trained set (e.g. COCO's ~80 everyday objects: person, cup, chair, bottle,
  ball, dog, etc.). No custom training. Whatever the model gives, we use.
- Detector: **YOLO / Ultralytics** (fast, trivial to run) or **MMDetection**
  (pairs with the animal work later). Either ships the COCO classes.
- Flow: sample frames across the clip → detect → collect class labels above a
  confidence threshold → dedupe → write as `tags` (source = `object-detector`).
- **Test it:** run on a handful of real clips, eyeball that the detected objects
  match the footage, and confirm the tags become searchable in the library.
- Don't run every frame — **sample** (e.g. a few frames/second); objects don't
  move that fast and per-frame is wasteful.

### Phase 6 — Vision-LLM auto-labeler (richer, builds on Phase 5)
- A Media-Lab action: sample N frames → image-to-text model → **proposed**
  description/tags the user accepts/edits.
- Complements Phase 5: object detection answers *"what objects are present"*
  cheaply; the LLM answers *"what's happening"* richly. They stack — keep both.

*(Later phase, separate handoff: dog + quadruped capture, which reuses the same
detector as its required first stage — MMDetection/YOLO → MMPose. See
`ANIMAL_MOCAP_HANDOFF.md`.)*

---

## 6. Files — touch map

**New (frontend)**
- Studio shell + tab router (new entry replacing the split `index.html` /
  `motion.html`)
- Queue sidebar component (poll/SSE → render → toast → navigate)
- Backend-file-browser panel for Intake

**New (backend)**
- `GET /api/files/browse` — sandboxed directory listing
- `POST /api/videos/import-by-path` — validate + move + enqueue
- `GET /api/queue` — job status feed
- Allowed-root config (default Downloads) in `backend/lib/paths.js`
- Object-detection worker (Phase 5) — YOLO/MMDetection over sampled frames →
  COCO-class tags written via the existing tag insert
- `POST /api/videos/:id/detect-objects` (or fold into a Media-Lab tag action)

**Modify**
- `backend/worker/process_video.py` — emit progress (`frames_done/total`)
- `backend/lib/processor.js` — record progress; expose job state to `/api/queue`
- `backend/routes/index.js` — register the new routes
- `src/app.js` — adapt the live tester into the Intake preview
- `src/motion.js` — adapt the library UI into the Media Lab tab
- `src/mediaLibrary.js` — reference pattern for the new file browser

**Reuse unchanged**
- `src/poseSkeleton.js` (shared mapping), `src/motionReplay.js`, `src/rigHost.js`
  + avatar variants, the DB schema, matrix/segment/search libs.

---

## 7. Gotchas

- **Browsers can't move files.** The move is backend-only and needs the real
  path — that's the whole reason for the backend file browser. Don't try to do
  it from an `<input type=file>`.
- **Move is destructive.** Confine to the allowed root, verify the file exists,
  and handle **duplicates before moving** (don't delete a Downloads file that's
  already in the library). Hard-confirm the allowed root so we never `rename`
  something outside it.
- **Cross-device `EXDEV`.** If Downloads and `data/` are on different mounts,
  `fs.rename` throws — fall back to copy-then-unlink.
- **Two extractors, one mapping.** Intake preview uses in-browser MediaPipe
  (throwaway); the stored canonical data uses the Python worker. Both must keep
  using the shared `poseSkeleton.js` mapping so they agree.
- **Tabs must not bleed.** Intake shows only un-imported Downloads files; Media
  Lab shows only DB items. Once Saved, an item leaves Intake's world entirely.
- **Don't break the live webcam studio use.** The webcam path (studio capture)
  must keep working; Intake's video-file preview is an addition, not a
  replacement.
- **Local-only.** Frontend ~`:5180`, backend ~`:5190`. No hosting assumptions.

---

## 8. Open Items To Confirm Before Phase 2/3

- **Allowed root(s):** just Downloads, or a small configurable list? Default and
  how it's set (env var / config file / settings UI)?
- **Naming on move:** keep original filename, or rename to `{id}` / a slug?
  (Affects how recognizable files are on disk.)
- **Queue transport:** polling (simplest) vs SSE (snappier). Start polling.
- **Concurrency:** confirm one-job-at-a-time to start.

---

Branch for this work: `claude/animal-motion-capture-2kath6` (current), or split
to a dedicated `studio-workflow` branch — decide before starting.

*Planning only — no code changed. Preserves the existing webcam studio path and
the existing DB/backend; the work is coherence plus the file-browser, move-on-
save, and queue capabilities.*
