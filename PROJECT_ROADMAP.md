# Project Roadmap — Studio, Avatars, Detection, Animals

> **Read this first.** It's the single entry point that ties the detailed
> handoffs together: the product vision, the app map, the locked decisions, the
> build order, and what's still open. Each tool has its own deep-dive doc,
> linked below.

---

## 1. The Vision

Turn this collection of pieces into **one coherent studio app** that fills and
manages a **searchable motion library**. Capture motion (from webcam in-studio,
or from video files), keep the takes worth keeping, label them, and later — from
a separate app (the **Bowtie** chat) — pull a motion by *describing* it
("someone walking") and replay it on **whatever character you choose**.

**Core principle: motion and character are decoupled.** Store landmarks once;
replay them on procedural characters *or* polished VRM avatars. The database is
the source of truth.

---

## 2. The App Map

The app opens on a **Home splash** that routes into tools. Each tool has a
`‹ Home` affordance.

```
HOME  (sexy splash / landing)
  │
  ├─►  Motion Capture     → Intake tab · Media Lab tab  (+ queue sidebar)
  │
  ├─►  Object Detection   → Live · Video · Multi
  │
  └─►  (later)  VRM avatars · Animals
```

- **Motion Capture** — the studio. *Intake* plays new footage and, on Save,
  physically **moves** the file into the DB-managed store and auto-starts
  background processing. *Media Lab* browses, labels, and replays the saved
  collection. A persistent **queue sidebar** shows job status and jumps you to
  finished clips.
- **Object Detection** — Live (webcam) / Video (file) / Multi, using a
  pre-trained detector's **built-in COCO classes** (no training). The detector
  built here is **reused** for library auto-tagging and the animal pipeline.
- **VRM avatars** and **Animals** plug in as additional characters/tools later.

---

## 3. Locked Decisions

| # | Decision | Notes |
|---|----------|-------|
| 1 | **One app, Home hub → tools** | Splash landing, client-side routing, `‹ Home` everywhere. |
| 2 | **"Words" = labels, not audio** | Manual tagging now; **object-detection** + **vision-LLM** auto-tagging later. No speech pipeline. |
| 3 | **Intake source = Downloads, user-selectable** | Browser can't move files → a **backend file browser** does the move by path. |
| 4 | **Save = physical MOVE + auto background processing** | Original leaves Downloads; job surfaces in the queue sidebar. |
| 5 | **Queue sidebar** | `Queued → Processing NN% → Ready/Error`; Ready → toast + click-to-jump into Media Lab. |
| 6 | **Procedural + VRM are co-equal** | Keep developing our characters *and* offer polished VRoid avatars; both driven from the same stored landmarks. |
| 7 | **Object detection is a real feature** | Built-in COCO classes, build-and-test. One detector, many consumers. |
| 8 | **Animal pose is two-stage, top-down** | `detect → crop → AP-10K pose`; the detector is a hard dependency. |

---

## 4. Build Order (locked default)

> Rationale: the shell is foundational; VRM is the highest-value Bowtie
> deliverable and independent of everything else; object detection is built
> right before the animal work that reuses its detector. **Adjustable** — if
> de-risking the heavy ML stack early matters more, swap VRM and Object
> Detection.

1. **Home hub + Motion Capture shell** — splash, routing, Intake/Media Lab tabs,
   placeholder queue. *(STUDIO, Phase 0)*
2. **Motion Capture backend** — file browser, move-on-save, queue + live status,
   labeling polish. *(STUDIO, Phases 1–4)*
3. **VRM / VRoid avatars** — co-equal character option, driven from the same
   landmarks. *(VRM, all phases)*
4. **Object Detection tool** — Live / Video / Multi; build the shared detector.
   *(OBJECT_DETECTION, Phases 0–3)*
5. **Auto-tagging** — wire the detector into Media Lab; vision-LLM labeling on
   top. *(STUDIO Phases 5–6, OBJECT_DETECTION Phase 4)*
6. **Dog / quadrupeds** — reuse the detector as Stage 1, add animal pose +
   skeleton + avatar. *(ANIMAL, all milestones)*

---

## 5. The Handoffs (deep dives)

| Doc | Covers |
|-----|--------|
| `STUDIO_WORKFLOW_HANDOFF.md` | Home hub, Motion Capture tool, Intake move-on-save, queue sidebar, Media Lab labeling, auto-tagging phases. |
| `VRM_AVATAR_HANDOFF.md` | VRoid/VRM avatars as co-equal characters via `@pixiv/three-vrm` + Kalidokit (landmarks → bone rotations). |
| `OBJECT_DETECTION_HANDOFF.md` | Standalone detection tool (Live/Video/Multi), the shared COCO detector, library auto-tagging. |
| `ANIMAL_MOCAP_HANDOFF.md` | Dog + quadruped capture: top-down detect → crop → MMPose AP-10K, procedural animal avatar. |

---

## 6. Still Open (sensible defaults chosen; confirm to change)

- **"Multi" mode meaning** — *defaulted to: detect multiple subjects/objects at
  once* (also the groundwork for multi-subject pose → the animal bridge).
  Alt readings: combined pose+objects on one feed, or multi-camera.
- **Build-order slots 3 & 4** — *defaulted to VRM before Object Detection*
  (Bowtie avatar sooner). Swap if de-risking the ML stack early wins.
- **One detector or two** — YOLO for the interactive Live/Video tool;
  MMDetection reserved for the animal pose pairing. Revisit if standardizing.
- **Filename on move** — keep original name vs rename to an ID/slug.
- **Where `.vrm` files live** — a scanned `vrm/` asset folder vs a picker.
- **Queue transport** — start with polling; SSE later if needed.

---

## 7. Architecture Truths To Respect (don't regress these)

- **Procedural path is sacred.** 32 characters depend on `mapPoseLandmark` and
  the 33-landmark schema. Everything new is **additive**.
- **One mapping, shared.** `src/poseSkeleton.js` is the procedural source of
  truth across frontend + backend. VRM and animals get their *own* driving paths
  and don't touch it.
- **Store landmarks, not renders.** The library keeps landmarks so any character
  (procedural / VRM / animal) can replay any motion. This is what makes the
  Bowtie "describe it → replay on any character" goal work.
- **Local-only.** Frontend ~`:5180`, backend ~`:5190`. No hosting assumptions.

---

*Planning only — no application code changed yet. These docs are the build spec
for a local session to execute against, in the order above.*
