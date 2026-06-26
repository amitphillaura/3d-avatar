# Object Detection Tool — Handoff

> **Purpose:** A standalone Object Detection screen, reached from the Home hub,
> that mirrors the Motion Capture tool's input options. Read top to bottom, then
> start at **Build Order → Phase 0**.
>
> Relationship to other handoffs: the Home splash + navigation live in
> `STUDIO_WORKFLOW_HANDOFF.md`. This tool also produces the **detector** that
> the Media-Lab auto-tagging (studio Phase 5) and the animal pipeline
> (`ANIMAL_MOCAP_HANDOFF.md`, required Stage 1) both reuse. Build the detector
> once, here.

---

## 1. The Shape

A dedicated tool with **three modes**, parallel to how Motion Capture takes
input:

```
OBJECT DETECTION        [‹ Home]
┌──────────┬──────────┬──────────┐
│  Live    │  Video   │  Multi   │
└──────────┴──────────┴──────────┘
```

- **Live** — webcam feed, boxes + labels drawn over it in real time.
- **Video** — open a video file, run detection over it, scrub/playback with
  boxes overlaid.
- **Multi** — *(ASSUMPTION — confirm with owner)* detect **many subjects/objects
  at once** and track them across the frame, rather than focusing on a single
  subject. See "Open Items." (Alt readings: combined pose+objects on one feed;
  multi-camera.)

This mirrors Motion Capture's Live/Video inputs so the two tools feel like
siblings.

---

## 2. The Detector (built here, reused everywhere)

Use a pre-trained detector with its **built-in classes out of the box** — the
standard COCO set (~80 everyday objects: person, cup, chair, bottle, ball, dog,
car, etc.). **No custom training.** Whatever the model ships, we use.

- **YOLO / Ultralytics** — fast, trivial to run, great for Live mode. Good
  default.
- **MMDetection** — heavier, pairs with MMPose for the animal work later. Pick
  this if you want one ML stack across object detection + animals.

> Decision: it's fine to use **YOLO in the browser/Node for Live + Video** and
> **MMDetection on the backend** for the animal pipeline — OR standardize on one.
> See Open Items. Either way, the *concept* (COCO classes, box + label +
> confidence) is identical.

**Output per frame:** a list of `{ class, confidence, box:[x,y,w,h] }`,
boxes in normalized 0–1 coords (consistent with the rest of the app).

---

## 3. Build Order

### Phase 0 — Static image detection
Stand up the chosen detector, run it on a single image, draw boxes + labels.
Prove the model loads and the COCO classes come through.
**Goal:** one image in → boxes out, rendered.

### Phase 1 — Live mode (webcam)
Wire the webcam feed → detector → overlay boxes/labels in real time. **Sample,
don't run every frame** if needed for performance (detect every N frames, hold
boxes between). Show FPS.
**Goal:** point the camera at a cup, see "cup 0.92" boxed live.

### Phase 2 — Video mode (file)
Open a video file, run detection across it, overlay boxes during playback; allow
scrub. Reuse the file-input pattern from Motion Capture (and later the backend
file browser).
**Goal:** play a clip, watch objects get boxed frame to frame.

### Phase 3 — Multi mode
Build per the confirmed definition (see Open Items). If "multiple subjects at
once": detect all boxes, assign stable IDs, track across frames, render N
labeled boxes. This is also the groundwork for **multi-subject pose** (detect
each → crop → pose each), the bridge to the animal pipeline.
**Goal:** several objects/people tracked simultaneously with stable labels.

### Phase 4 — Feed the library (ties into studio Phase 5)
Expose the detector as a backend job so the Media Lab can auto-tag saved clips
(sample frames → detect → COCO labels → searchable tags). Same detector, batch
context.
**Goal:** detected objects become searchable tags on stored motions.

---

## 4. Files — touch map

**New (frontend)**
- Object Detection tool screen + its three mode views (Live / Video / Multi),
  reached from the Home hub.
- Box/label overlay renderer (canvas over the video/camera element).

**New (backend, shared with animals + studio Phase 5)**
- Detector worker (YOLO or MMDetection) — `frame → [{class,confidence,box}]`.
- A detect endpoint/job for batch use (auto-tagging, and the animal Stage 1).

**Reuse**
- Camera/video input plumbing from `src/app.js` (Motion Capture's Live/Video).
- The Home hub + routing from `STUDIO_WORKFLOW_HANDOFF.md`.
- The existing tag insert (`POST /api/videos/:id/tags`) for auto-tagging.

---

## 5. Gotchas

- **Don't run every frame in Live.** Detection per frame can tank FPS — sample
  (every N frames) and hold boxes between, or use a small/fast model.
- **One detector, many consumers.** Live overlay, video overlay, library
  auto-tagging, and the animal Stage 1 all want the same detector — build it
  once with a clean interface, don't fork it per screen.
- **Normalized boxes.** Keep boxes in 0–1 coords like the rest of the app so
  overlays and downstream crops are resolution-independent.
- **COCO is fixed.** The built-in classes are what they are (~80). If you later
  need objects outside that set, that's custom training — a separate effort, not
  in scope.
- **Model weight downloads.** YOLO/MMDetection fetch weights on first run —
  check the network policy allows it; cache locally for offline studio use.

---

## 6. Open Items To Confirm

- **What is "Multi"?** (a) many objects/subjects at once [assumed], (b) combined
  object-detection + motion-capture on one feed, or (c) multi-camera. This
  drives Phase 3.
- **One detector or two?** YOLO for Live/Video + MMDetection for animals, or
  standardize on one stack. (Leaning: YOLO for the interactive tool, MMDetection
  reserved for the animal pose pairing — revisit.)
- **Live vs backend inference.** Run the detector in-browser (snappy, no
  round-trip) or on the backend (heavier models, consistent with batch). Live
  mode probably wants in-browser; batch/auto-tag wants backend.

---

Branch: `claude/animal-motion-capture-2kath6` (current) or a dedicated branch.
Sequencing: Home hub + Motion Capture shell first (studio handoff), then this
tool, since it reuses the hub, routing, and input plumbing.

*Planning only — no code changed.*
