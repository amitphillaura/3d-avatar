# VRoid / VRM Avatar Integration — Handoff

> **Purpose:** Add VRoid (VRM) avatars as a **co-equal** character option
> alongside the existing procedural characters. Both are first-class; both are
> driven from the **same stored landmarks**. Read top to bottom, then start at
> **Build Order → Phase 0**.
>
> Relationship to other handoffs: the studio two-tab workflow
> (`STUDIO_WORKFLOW_HANDOFF.md`) is the surrounding app; animals
> (`ANIMAL_MOCAP_HANDOFF.md`) are a separate later effort. This doc is the
> "nicer humanoid avatar" track.

---

## 1. The Decision (locked)

VRM is **co-equal**, not a replacement:
- **Procedural characters** (the 32 Mushy variants) — keep developing them;
  fast, tiny, stylized, fully ours.
- **VRoid / VRM avatars** — a polished, expressive, standards-based humanoid
  option (the likely "hero" avatar for the downstream Bowtie chat).
- **Both pick from the same character selector. Both replay the same stored
  motion.** The user chooses per playback.

This *strengthens* the project's core principle: **motion and character are
decoupled.** Store landmarks once, drive anything.

---

## 2. What VRM Is, and Why It Doesn't Drop In As-Is

**VRM** is a glTF-based standard for humanoid avatars (what VRoid Studio
exports). It ships a **standard humanoid bone hierarchy** (hips, spine, chest,
neck, head, shoulders, arms, legs, fingers), facial **blendshapes/expressions**,
look-at, and **spring bones** for hair/cloth physics.

**The fundamental difference from our current characters:**

| | Procedural characters | VRM avatar |
|---|---|---|
| Mesh | primitives (spheres/cylinders) | rigged, **skinned** humanoid |
| How it's driven | **place** each joint at a landmark position | **rotate** each bone (quaternions) |
| Per-frame input | world-space positions (`mapPoseLandmark`) | **bone rotations + blendshapes** |

So VRM **cannot** reuse the direct-placement path. It needs landmark positions
converted into **bone rotations**. That conversion is a separate, parallel
driving path — not a tweak to the existing one.

---

## 3. The Toolchain (both Three.js-native)

- **`@pixiv/three-vrm`** — loads `.vrm` into Three.js (on top of GLTFLoader).
  Provides the humanoid rig, expression/blendshape manager, look-at, and
  spring-bone updates.
- **`Kalidokit`** — solves **MediaPipe Holistic landmarks → VRM bone rotations,
  face blendshapes, and finger poses**. Built for exactly our input (pose +
  face + both hands). Framework-agnostic (takes landmark arrays).

Pipeline:

```
MediaPipe Holistic  (already have this — live AND in stored frames)
   → Kalidokit.solve()  →  bone rotations + blendshapes
   → @pixiv/three-vrm avatar  →  rendered
```

> Note: Kalidokit is older / lightly maintained, but framework-agnostic and
> still the standard bridge. Expect to **tune** it, not get perfect output
> out of the box. If it proves too rough, the fallback is a hand-rolled
> landmark→bone-rotation solver (more work, full control).

---

## 4. How It Fits The Architecture

- **New rig variant in the `rigHost` registry**, listed alongside the 32
  procedural ones — but its per-frame `sync` runs the **Kalidokit solve +
  three-vrm update** instead of direct placement.
- **Same landmarks, two driving paths:**

```
                       ┌─ direct placement ─→ procedural character
 stored/live landmarks ┤
                       └─ Kalidokit solve ──→ VRM avatar
```

- Because the **motion library stores raw landmarks** (the studio plan), any
  saved motion replays on a procedural *or* VRM character with no re-processing.
  Character is chosen at replay time. This is the whole point.
- The shared `src/poseSkeleton.js` mapping stays the procedural path's source of
  truth; VRM gets its **own** solver module and does **not** touch it.

---

## 5. Build Order

### Phase 0 — Render a static VRM
Add deps (`@pixiv/three-vrm`, GLTFLoader path), load one VRoid `.vrm` into a
Three.js scene, get it standing in a T/A-pose with lighting. No tracking yet.
**Goal:** a VRM renders in our scene.

### Phase 1 — Drive it live with Kalidokit
Feed live MediaPipe Holistic landmarks → `Kalidokit` → apply bone rotations +
blendshapes to the VRM each frame. Update spring bones per frame.
**Goal:** the VRM mirrors a person from the webcam/video, upper body + face +
hands.

### Phase 2 — Register as a co-equal variant
Wrap it so it loads through `rigHost` and appears in the character selector next
to the procedural ones. Selecting it swaps the driving path.
**Goal:** pick "VRoid" from the same dropdown as Mushy; both work.

### Phase 3 — Replay from the library
Make stored-landmark replay drive the VRM (not just live). Confirm the same
saved segment plays on both a procedural character and the VRM.
**Goal:** motion/character decoupling proven end-to-end with VRM.

### Phase 4 — Smoothing & polish
Smooth at the **rotation/landmark** level (not position): pre-smooth landmarks
before solving, or smooth output quaternions. Tune leg/foot damping. Wire facial
expressions (blink, mouth) from face landmarks.
**Goal:** stable, non-jittery, expressive VRM.

### Phase 5 — Multiple VRoid models
Let the user drop in / select among several `.vrm` files. Decide where they live
(a `vrm/` asset folder) and how they're listed.

---

## 6. Files — touch map

**New (frontend)**
- A VRM rig module (loads via `@pixiv/three-vrm`, runs Kalidokit per frame) —
  the VRM analog of an `avatar*.js`, but rotation-driven.
- A landmark→VRM solver wrapper around Kalidokit (so the rig module stays clean).

**Modify**
- `src/rigHost.js` — register the VRM variant in `RIG_VARIANTS`.
- `src/motionReplay.js` — allow the replay loop to feed landmarks to the VRM
  driving path as well as the procedural one.
- character selector UI — list VRM alongside procedural.
- `package.json` — add `@pixiv/three-vrm` (+ ensure GLTFLoader available).

**Reuse unchanged**
- MediaPipe Holistic capture, stored landmark frames, the DB/library, the
  procedural path and `src/poseSkeleton.js`.

---

## 7. Gotchas

- **Rotate, don't place.** The mental model is completely different from the
  procedural rigs — don't try to bend `mapPoseLandmark` into VRM.
- **Lower body is noisy.** MediaPipe legs/feet jitter; VRM exposes it more than
  primitives do. Expect extra damping for walking.
- **Smooth rotations, not positions.** One-Euro on positions doesn't transfer —
  smooth landmarks pre-solve or quaternions post-solve.
- **VRM version + facing.** VRM 0.x faces −Z, VRM 1.0 faces +Z; `three-vrm`
  handles it but branch on the loaded version.
- **Spring bones** need a per-frame update call or hair/cloth freezes.
- **Weight.** VRM files are megabytes vs ~1 KB procedural variants — lazy-load,
  don't bundle. Skinned mesh is heavier to render (still fine).
- **Licensing.** VRoid/VRM files embed **use-condition metadata**. For a
  commercial Bowtie deployment, read and respect those fields per model.
- **Kalidokit maintenance.** Older lib; pin the version, be ready to tune or
  replace with a custom solver.
- **Don't regress the procedural path.** VRM is additive; the 32 characters and
  the live/replay paths must keep working unchanged.

---

## 8. Open Items To Confirm

- **Where do `.vrm` files live** and how are they discovered (a `vrm/` folder
  scanned at startup? a picker?).
- **Default hero avatar** for Bowtie — a specific VRoid model, or user-chosen?
- **Kalidokit vs custom solver** — start with Kalidokit (fast), accept its
  limits; revisit if quality is insufficient.
- **Expressions scope** — just blink/mouth from landmarks now, or full emotion
  mapping later?

---

Branch: `claude/animal-motion-capture-2kath6` (current) or a dedicated branch —
decide before starting. Sequencing suggestion: land the **studio two-tab
workflow** first (so there's a clean place to pick characters and replay), then
VRM, then animals.

*Planning only — no code changed. VRM is additive and preserves the procedural
characters as a co-equal, both driven from the same stored landmarks.*
