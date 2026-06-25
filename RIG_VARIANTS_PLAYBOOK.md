# Mushy Rig Variants — Build Playbook

> How to add a new 3D character variant to the Live Pose Tester. Written so that **any
> agent can follow it mechanically** and ship a working, good-looking character without
> understanding the whole codebase. Read this top to bottom once, then use it as a recipe.

This pipeline has produced **32 characters** so far (Mushy, MushyKid, MushyPrime, MushyGhost,
MushyAstro, MushyDragon, MushyNeon, MushySlime, MushyShade, MushyBloom, MushyWurm, MushyCog,
MushyVoxel, MushyGem, MushyTrail, MushyFuzz, MushyAqua, MushyEmber, MushyNimbus, MushyPix,
MushyJack, MushyStar, MushyKnight, MushyMushroom, MushyOcto, MushyBee, MushyMagma, MushyTV,
MushyAngel, MushyPlush, MushyPirate, MushySkeleton). Every one is a **clone of `src/avatar.js`**
with a custom look and one animated technique. You will do exactly the same thing.

> Newer techniques worth knowing (templates): a **prop anchored to a hand landmark** —
> `avatarKnight.js` (a shield that rides `this.points.get('leftWrist')`); an **animated screen
> face** (redrawn `CanvasTexture` with scanlines) — `avatarTV.js`; **multiple follow-chains**
> (tentacles) — `avatarOcto.js`; **asymmetric/replaced limb caps** (hook + peg) —
> `avatarPirate.js`; an **anchored bobbing accessory** (halo) — `avatarAngel.js`.

---

## 0. TL;DR (the whole job in 6 steps)

1. `cp src/avatar.js src/avatarYOURNAME.js`
2. Edit **only that file**: rename the class, swap the palette/`BONE_STYLE`, add material
   helper(s), rewrite `createRig()` (+ helper methods), add `syncAttachedModel(delta)`,
   change the scene background color, the two `buildHandRig()` colors, and the two meta strings.
3. **Keep the HARD CONTRACT intact** (§3) or the app crashes.
4. `node --check src/avatarYOURNAME.js` — must pass.
5. Register it: 1 import + 1 registry line in `src/rigHost.js`, and 1 `<option>` in `index.html` (§6).
6. `npm run build`, then verify in the browser (§7). Then commit / merge / deploy / push (§8).

A new variant = **one new file + 3 one-line edits to two existing files.** Nothing else changes.

---

## 1. How the system works (the 30-second mental model)

- The app captures a human with MediaPipe and produces **landmarks** (nose, shoulders,
  wrists, hips, knees, ankles, …).
- `src/rigHost.js` mounts ONE avatar at a time into the "Rig" tile and feeds it landmarks.
  Which avatar is decided by the **rig dropdown** in `index.html` (the `RIG_VARIANTS` registry).
- An avatar (e.g. `src/avatar.js`, class `MushyAvatar`) builds a Three.js scene of primitive
  meshes (spheres, cylinders, boxes) and, **every frame**, positions those meshes at the
  landmark world-positions. There is **no skinning, no bone hierarchy, no IK** — each mesh is
  just placed at a point. That is why this is easy and robust.
- A variant is a copy of that class with different geometry/materials and one extra animated
  flourish. The landmark-driving code is inherited unchanged.

**You do not need to understand the driving math.** You only customize what the meshes look
like (`createRig`) and add per-frame motion (`syncAttachedModel`).

---

## 2. The exact mechanical edits

After `cp src/avatar.js src/avatarYOURNAME.js`, make these find/replace edits in your file.
The text on the left is the EXACT original from `avatar.js`. Look at any finished variant
(e.g. `src/avatarSlime.js`, `src/avatarKid.js`) to see a real example of each.

### 2a. Rename the class
```
FIND:    export class MushyAvatar {
REPLACE: export class MushyYourName {
```

### 2b. Palette + BONE_STYLE
```
FIND:
const BONE_STYLE = {
  collar: { radius: 0.055, color: 0x7df8ce },
  hip: { radius: 0.06, color: 0x75a7ff },
  arm: { radius: 0.045, color: 0xff7bd5 },
  leg: { radius: 0.052, color: 0x75a7ff },
  side: { radius: 0.04, color: 0x37e9a8 }
};
```
REPLACE with a palette object + a `BONE_STYLE` that keeps the 5 keys
(`collar`, `hip`, `arm`, `leg`, `side`), each `{ radius, color }`. Bones are the limbs/torso
connectors. `arm` = upper+lower arms, `leg` = legs+feet, `collar` = shoulder line,
`hip` = hip line, `side` = the two shoulder→hip lines. Radius ~0.04–0.11 (bigger = chunkier).

### 2c. Material helpers (optional but usual)
Right AFTER the existing `makeMaterial(...)` function, add your own helpers
(`makeGlow`, `makeMetal`, `makeGem`, etc.). See §5 for the standard recipes.

### 2d. Scene background color
```
FIND:    this.scene.background = new THREE.Color(0x06080e);
REPLACE: this.scene.background = new THREE.Color(0xYOURBG);
```
Pick a dark color that complements the character (dark teal for slime, near-black for shade,
warm dark for ember/cog, etc.).

### 2e. Finger-rig hand colors
```
FIND:
    this.hands = {
      left: this.buildHandRig(0xff7bd5),
      right: this.buildHandRig(0x59a6ff)
    };
REPLACE both colors with your palette (finger bones, only visible when hand-tracking is on).
```

### 2f. The two meta strings (status text)
```
FIND:    this.metaElement.textContent = `Mushy tracking · ${parts.join(" · ")}`;
REPLACE: `Mushy` -> `MushyYourName`

FIND:    this.metaElement.textContent = "Mushy waiting for your body pose";
REPLACE: "MushyYourName waiting for your body pose"
```

### 2g. Rewrite `createRig()` — the main job (§4)

### 2h. Add `syncAttachedModel(delta)` — your animated technique (§4)
Insert it between `setZoom(...)` and `setPaused(...)`:
```
  setZoom(value) {
    const v = Number(value);
    this.zoom = Number.isFinite(v) ? Math.min(Math.max(v, 0.5), 2) : 1;
  }

  // <<< INSERT your syncAttachedModel(delta) { ... } HERE >>>

  setPaused(paused) {
```

---

## 3. THE HARD CONTRACT (break these = the app crashes or renders nothing)

Your `createRig()` MUST end with all of these defined, because inherited methods
(`updateRig`, `animateIdle`, `applySkeletonVisibility`, `ensureJointLabels`, …) use them:

| Property | Type | Notes |
|---|---|---|
| `this.joints` | `Map<name, Mesh>` | Built by the **standard joints loop** — keep it verbatim, only change the joint geometry/material. It also fills `this.points`, `this.targetPoints`, `this.filters`. |
| `this.bones` | `Array<{from,to,mesh}>` | Built by the `BONES.forEach` loop. Each `mesh` is a unit-tall mesh the base stretches between two joints. |
| `this.caps` | object | **EXACTLY** keys `leftWrist`, `rightWrist`, `leftAnkle`, `rightAnkle`. Each a `Mesh`, `visible=false`, added to `this.root`. (Hands & feet.) |
| `this.neck` | `Mesh` | `visible=false`, added to `this.root`. |
| `this.torso` | `Mesh` | The torso. The base sets its `.position`, `.scale`, `.quaternion` every tracked frame. |
| `this.head` | `Mesh` | The head. The base sets its `.position`, `.scale`, `.quaternion`. |
| `this.antenna` | `Object3D` (Group or Mesh) | Needs a `.rotation`; the idle animation sets `this.antenna.rotation.z`. Put it on the head. |
| `this.leftEye`, `this.rightEye` | any `Mesh` | Just need to exist (can be tiny/invisible if your face is drawn another way). |

Also:
- **Do NOT modify any other method**, and **do NOT touch any other file** except the two
  registration edits in §6.
- The class must be a **named export**: `export class MushyYourName { … }`.

### The standard joints loop (KEEP THIS — only change geometry/material)
```js
const jointGeometry = new THREE.SphereGeometry(0.085, 16, 16);   // <- change look here
const jointMaterial = makeMaterial(SOMECOLOR, 0.6);              // <- and here
Object.keys(BODY_POINTS).forEach((name) => {
  const joint = new THREE.Mesh(jointGeometry, jointMaterial);
  joint.visible = false;
  this.root.add(joint);
  this.joints.set(name, joint);
  this.points.set(name, new THREE.Vector3());
  this.targetPoints.set(name, new THREE.Vector3());
  this.filters.set(name, {
    x: new OneEuro(),
    y: new OneEuro(),
    z: new OneEuro({ minCutoff: 0.7, beta: 0.006 })
  });
});
```

### The standard bones loop (KEEP the shape — change geometry/material)
```js
BONES.forEach(([from, to, variant]) => {
  const style = BONE_STYLE[variant];
  const geometry = new THREE.CylinderGeometry(style.radius, style.radius, 1, 14);
  const mesh = new THREE.Mesh(geometry, makeMaterial(style.color, 0.5));
  mesh.visible = false;
  this.root.add(mesh);
  this.bones.push({ from, to, mesh });   // MUST push {from, to, mesh}
});
```
The base helper `setCylinderBetween(mesh, start, end)` does `mesh.scale.set(1, length, 1)` plus
a rotation, so a **`BoxGeometry` works here too** (a stretched box = a blocky limb — see Voxel).

---

## 4. `createRig()` and `syncAttachedModel()` — what you actually design

### `createRig()`
Rebuild the body from primitives. Typical structure (copy a finished variant and adapt):
1. The standard joints loop (§3) with your joint look.
2. `this.caps = { leftWrist, rightWrist, leftAnkle, rightAnkle }` — your hands/feet, all
   `visible=false`, added to `this.root`.
3. `this.neck` (`visible=false`).
4. The standard bones loop (§3) with your bone look.
5. `this.torso` and `this.head` (your shapes/materials).
6. A face on the head: usually a `buildFace()`/`buildXHead()` helper that adds eyes, mouth,
   and sets `this.leftEye`/`this.rightEye` and `this.antenna`. Face features are **children of
   `this.head`** so they follow head movement/scale automatically.
7. Any extra parts your technique needs (tails, wings, particle pools, gears, point clouds…) —
   add them to `this.root` (NOT to torso/head unless you want them to inherit that scale) and
   store refs on `this` (e.g. `this._flames`, `this._rain`, `this._trails`).

### `syncAttachedModel(delta)` — the per-frame hook
The base calls `this.syncAttachedModel?.(delta)` **every frame**, after the rig has been
positioned and before the camera/render. `delta` = seconds since last frame (capped at 0.05).
This is where ALL your animation goes. Patterns:

- **Time:** `const t = (performance.now() - this.startedAt) / 1000;` (seconds since spawn).
- **Anchor extra parts to the body:** read `this.torso.position` / `this.head.position`
  (live world positions, valid in idle and tracking) and place your parts relative to them.
- **Live hand/joint positions:** `this.points.get("leftWrist")` (and any landmark name from
  §9) returns a `THREE.Vector3` the base updates each frame — use for trails, effects.
- **Hide the humanoid rig (for non-humanoid characters)** — set everything invisible each
  frame and draw your own body (see Ghost/Wurm/Nimbus/Pix):
  ```js
  this.bones.forEach(({ mesh }) => { mesh.visible = false; });
  this.joints.forEach((j) => { j.visible = false; });
  Object.values(this.caps).forEach((c) => { c.visible = false; });
  this.neck.visible = false;
  // optionally this.torso.visible = false / this.head.visible = false
  ```
- `Math.random()` and `performance.now()` are fine to use here.
- **Always guard:** `if (!this._yourPool) return;` — `createRig` runs before the first frame,
  but guard anyway.

---

## 5. Material & technique cookbook (proven recipes)

### Materials
```js
// Solid matte/standard (the base default):
function makeMaterial(color, roughness = 0.52) {
  return new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.08,
    emissive: color, emissiveIntensity: 0.06 });
}
// Brushed metal (Prime, Cog):
function makeMetal(color, r = 0.4) {
  return new THREE.MeshStandardMaterial({ color, roughness: r, metalness: 0.92,
    emissive: 0x05070b, emissiveIntensity: 0.25 });
}
// Self-lit glow, reads bright regardless of lighting (Prime visor, Neon eyes, Shade eyes):
function makeGlow(color) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.3, metalness: 0,
    emissive: color, emissiveIntensity: 0.9 });
}
// Translucent goo/ghost/water (use depthWrite:false to blend overlaps cleanly):
function makeSoft(color, opacity = 0.6) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.2, transparent: true,
    opacity, emissive: color, emissiveIntensity: 0.15, depthWrite: false });
}
// Additive glow (neon lines, smoke wisps, points) — bloom-like on a dark bg:
function makeAdditive(color, opacity = 0.7) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity,
    blending: THREE.AdditiveBlending, depthWrite: false });
}
```

### Animated techniques already in the repo (copy the closest one as a template)
| Technique | Template file | One-liner |
|---|---|---|
| Procedural face (eyes/nose/mouth) | `avatarKid.js` | children of `this.head` |
| Box/metal/glow plating | `avatarPrime.js` | `makeMetal` + `BoxGeometry` |
| Alt render style (wireframe/additive) + flicker | `avatarNeon.js` | `wireframe:true`, flicker opacity in sync |
| Non-humanoid tail (hide legs, swaying tail) | `avatarGhost.js` | hide lower bones; tail group anchored to torso |
| Nested transparent helmet + segmented limbs | `avatarAstro.js` | helmet child of head; beads slid along bones |
| Flapping wings + tail | `avatarDragon.js` | wing groups anchored to torso, rotate in sync |
| Spring jiggle (squash & stretch) | `avatarSlime.js` | damped spring on a blob's scale, kicked by speed |
| Particle pool (emit/drift/fade) | `avatarShade.js` | array of meshes; respawn at body, advance, fade |
| Radial instancing (petal/sunburst ring) | `avatarBloom.js` | meshes placed at angles around a point |
| Surface scatter (fur/spikes) | `avatarFuzz.js` | fibonacci-sphere distribute cones over a mesh |
| Follow-chain (snake/caterpillar) | `avatarWurm.js` | distance-constrained chain trailing the head |
| Continuous spin (gears/props) | `avatarCog.js` | `mesh.rotation.z += rate*delta` |
| Texture map / pixel face | `avatarVoxel.js` | `CanvasTexture` + `NearestFilter` on a plane |
| Faceted + inner glow | `avatarGem.js` | low-poly `flatShading` shell + emissive core |
| History-buffer ribbon trail | `avatarTrail.js` | `THREE.Line` updated from a position ring buffer |
| Animated inner ripple + inhabitant | `avatarAqua.js` | animate CHILD meshes, never the base body scale |
| Flame tongues (flicker + color-cycle emissive) | `avatarEmber.js` | cones, `material.emissive.setRGB(...)` in sync |
| Cluster body + falling particles + flash | `avatarNimbus.js` | puff cluster, rain pool, strobe a bolt mesh |
| Billboard sprite + animated texture | `avatarPix.js` | `THREE.Sprite` + `CanvasTexture`, redraw frames |
| Lit-from-within (carved glow) | `avatarJack.js` | emissive cutouts + an inner `PointLight` flicker |
| Point-cloud body | `avatarStar.js` | `THREE.Points` clouds anchored to body each frame |

### Texture / canvas faces (Voxel, Pix)
```js
const canvas = document.createElement("canvas");
canvas.width = canvas.height = 16;
const ctx = canvas.getContext("2d");
/* draw pixels with ctx.fillRect(...) */
const tex = new THREE.CanvasTexture(canvas);
tex.magFilter = THREE.NearestFilter;       // crisp pixels
tex.minFilter = THREE.NearestFilter;
// As a material map: new THREE.MeshBasicMaterial({ map: tex, transparent: true })
// As a billboard:   new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true }))
// To animate: redraw the canvas, then set tex.needsUpdate = true.
```

---

## 6. Register the variant (2 files, 2 lines)

### `src/rigHost.js`
Add one line to the `RIG_VARIANTS` object (variants lazy-load via dynamic `import()`):
```js
  mushyYourName: variantSpec("MushyYourName", () => import("./avatarYourName.js")),
```
(The registry key is camelCase; the dropdown `<option value>` must match it exactly.)

### `index.html`
Add an `<option>` inside `<select id="rigVariant">`:
```html
                  <option value="mushyYourName">MushyYourName</option>
```
That's it — `RigHost.setVariant()`, zoom carry-over, the joints toggle, persistence, and the
camera all work automatically for any registered variant.

Run `npm run check:rig-registry` to confirm the registry, dropdown, and module path stay in sync.

---

## 7. Verify (don't skip)

```bash
node --check src/avatarYourName.js     # syntax — must be silent
npm run check:rig-registry             # registry ↔ dropdown ↔ module file
npm run build                          # must succeed (catches import/type errors)
```
Then in the browser (dev server `npm run dev`, or the running prod on http://127.0.0.1:5180):
1. Pick your variant in the **Rig** dropdown.
2. Confirm it renders (in idle you'll see head + torso + your extras; limbs only show when a
   pose is tracked).
3. Check the browser console for errors (a bad `syncAttachedModel` throws every frame).
4. Switch to a couple of other variants and back — confirm there's still exactly **one**
   `<canvas>` in `#riggedModelMount` (no leak) and no errors.
5. Toggle **Joints** off and use the footer **Zoom** slider to inspect.

Quick console self-check (paste in devtools):
```js
const s = document.getElementById('rigVariant');
s.value = 'mushyYourName'; s.dispatchEvent(new Event('change', {bubbles:true}));
console.log(window.__avatar.constructor.name,
            document.querySelectorAll('#riggedModelMount canvas').length);
```

---

## 8. Ship

This project deploys to a local prod server on **:5180** (a launchd job that rebuilds `dist/`).
The standard flow (only do the deploy/push steps if asked — committing is usually fine):
```bash
git add -A && git commit -m "Add MushyYourName variant"            # on the feature branch
git -C "/Users/amit/Projects/3d Avatar" merge --ff-only <branch>   # fast-forward main
launchctl kickstart -k "gui/$(id -u)/com.amit.3davatar.pose-tester" # rebuild + reserve :5180
git push origin main                                                # GitHub
```
Verify `curl -s http://127.0.0.1:5180/ | grep mushyYourName` after the restart.

---

## 9. Reference data

### Landmark names (`BODY_POINTS` / `POSE_LM`, from `src/poseSkeleton.js`)
`nose`(0), `leftShoulder`(11), `rightShoulder`(12), `leftElbow`(13), `rightElbow`(14),
`leftWrist`(15), `rightWrist`(16), `leftHip`(23), `rightHip`(24), `leftKnee`(25),
`rightKnee`(26), `leftAnkle`(27), `rightAnkle`(28), `leftHeel`(29), `rightHeel`(30),
`leftFootIndex`(31), `rightFootIndex`(32). These are the keys in `this.joints`/`this.points`.

### Bones (`BONES`) — `[from, to, variant]`
```
collar: leftShoulder–rightShoulder
hip:    leftHip–rightHip
arm:    leftShoulder–leftElbow, leftElbow–leftWrist, rightShoulder–rightElbow, rightElbow–rightWrist
leg:    {l,r}Hip–{l,r}Knee, {l,r}Knee–{l,r}Ankle, {l,r}Ankle–{l,r}Heel, {l,r}Heel–{l,r}FootIndex
side:   leftShoulder–leftHip, rightShoulder–rightHip
```
To make a character **non-humanoid below the waist** (Ghost), hide bones/joints whose name is
a lower-body landmark (hips/knees/ankles/heels/feet) in `syncAttachedModel`.

### World-space coordinate cheatsheet
Landmarks map to world space via `mapPoseLandmark`:
`x = (0.5 - lm.x) * 4.3`, `y = (0.58 - lm.y) * 4.8`, `z = -0.65 - lm.z*1.4`.
Practical consequences for placing static/idle parts:
- The figure faces **+z** (toward the camera). "Front of the face" is `+z`.
- Up is **+y**. A standing figure spans roughly **y ∈ [-1.6 (feet), +1.3 (head)]**.
- In full idle (no tracking), the base parks **torso at ~(0, -0.25, -0.65)** and
  **head at ~(0, 1.05, -0.65)**, with a gentle bob. So extras you anchor to `this.torso.position`
  look right both when idle and when tracking.
- Typical sizes: head sphere radius ~0.3–0.46, torso sphere ~0.82 (then scaled), bone radii
  ~0.05–0.11, hand caps ~0.13–0.17, foot caps ~0.13–0.18.

### Inherited helpers you can call/use
- `setCylinderBetween(mesh, start, end)` (module fn) — stretches a unit mesh between two points.
- `makeMaterial(color, roughness)` (module fn) — the default standard material.
- `midpoint(a, b)` (module fn) — midpoint Vector3.
- `this.startedAt` — `performance.now()` at construction (for time-based animation).
- `this.zoom` / `setZoom()` and `setShowJointLabels()` — inherited, don't override.
- `OneEuro` — the smoothing filter class (used by the joints loop; you won't call it directly).

### The frame loop (for context — do not edit `animate`)
```js
animate() {
  // ...
  this.animateIdle(delta);     // idle bob + parks parts when no tracking
  this.updateRig(delta);       // positions joints/bones/caps/torso/head from landmarks
  this.syncAttachedModel?.(delta);  // <-- YOUR per-frame hook
  this.frameBodyCamera();
  this.renderFrame();
  // ...
}
```

---

## 10. Pitfalls & rules (learned the hard way)

1. **Don't fight the base transform.** The base sets `this.torso`/`this.head`
   `.position/.scale/.quaternion` every tracked frame. If your technique needs to scale/wobble
   the body, **animate a child mesh you added** (Aqua) or a **separate group** (Slime's blob),
   not `this.torso.scale` — otherwise you compound or get overwritten.
2. **Children inherit parent scale.** Parts added to `this.torso`/`this.head` get squashed by
   the base's non-uniform torso scale. That's fine for flat panels; for round things you want
   undistorted, parent to `this.root` and position from `this.torso.position` each frame.
3. **Translucency:** set `transparent:true` and usually `depthWrite:false`, or overlapping
   translucent meshes render in the wrong order.
4. **Glow on a dark bg:** `MeshBasicMaterial` + `THREE.AdditiveBlending` + `depthWrite:false`
   reads as neon/light. Pick a dark `scene.background`.
5. **`this.antenna` must have `.rotation`** (Group or Mesh). The idle loop does
   `this.antenna.rotation.z = ...`. If you don't want a literal antenna, make it a tiny/hidden
   group on the head — but it must exist.
6. **`this.caps` keys are exact:** `leftWrist`, `rightWrist`, `leftAnkle`, `rightAnkle`. No more,
   no fewer. Each added to `this.root`, `visible=false`.
7. **Keep the joints loop verbatim** (only geometry/material differ) — it wires up
   `this.points`/`this.targetPoints`/`this.filters` which the driver needs.
8. **One file per variant.** Never edit another variant's file or `avatar.js`. The only shared
   edits are the 3 registration lines (§6).
9. **`node --check` then `npm run build`** before claiming done. The build catches a bad import
   or a stray syntax error a single-file check can miss.
10. **Verify in the browser**, including switching away and back (canvas-leak check) and the
    console (a throwing `syncAttachedModel` spams errors every frame but won't crash the build).
11. **`Math.random()` / `performance.now()`** are fine in avatar code (they're only forbidden in
    Workflow scripts, which this is not).
12. **Geometry counts cost.** Hundreds of meshes/particles per character is OK; tens of
    thousands is not. Reuse a shared material across many meshes when you can (Fuzz, Cog).

---

## 11. Minimal worked example (a complete tiny variant)

`src/avatarBlankExample.js` would be `avatar.js` with these diffs. This makes a plain
two-tone character that gently bobs an orb — copy it and go wild.

```js
// 2b — palette + BONE_STYLE
const BLANK = { body: 0x8fd0ff, trim: 0x2a6bd0, eye: 0x10202c };
const BONE_STYLE = {
  collar: { radius: 0.07, color: BLANK.trim },
  hip:    { radius: 0.08, color: BLANK.trim },
  arm:    { radius: 0.06, color: BLANK.body },
  leg:    { radius: 0.08, color: BLANK.trim },
  side:   { radius: 0.06, color: BLANK.trim }
};

// 2a — class
export class MushyBlankExample {
  // ...constructor unchanged...

  // 2g — createRig (joints loop kept verbatim; only the look differs)
  createRig() {
    const jointGeometry = new THREE.SphereGeometry(0.085, 16, 16);
    const jointMaterial = makeMaterial(BLANK.body, 0.5);
    Object.keys(BODY_POINTS).forEach((name) => {
      const joint = new THREE.Mesh(jointGeometry, jointMaterial);
      joint.visible = false; this.root.add(joint);
      this.joints.set(name, joint);
      this.points.set(name, new THREE.Vector3());
      this.targetPoints.set(name, new THREE.Vector3());
      this.filters.set(name, { x: new OneEuro(), y: new OneEuro(),
        z: new OneEuro({ minCutoff: 0.7, beta: 0.006 }) });
    });

    const cap = makeMaterial(BLANK.body, 0.5);
    this.caps = {
      leftWrist:  new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), cap),
      rightWrist: new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 16), cap),
      leftAnkle:  new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), cap),
      rightAnkle: new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), cap)
    };
    Object.values(this.caps).forEach((c) => { c.visible = false; this.root.add(c); });

    this.neck = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 1, 12),
      makeMaterial(BLANK.body, 0.5));
    this.neck.visible = false; this.root.add(this.neck);

    BONES.forEach(([from, to, variant]) => {
      const style = BONE_STYLE[variant];
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(style.radius, style.radius, 1, 12),
        makeMaterial(style.color, 0.5));
      mesh.visible = false; this.root.add(mesh);
      this.bones.push({ from, to, mesh });
    });

    this.torso = new THREE.Mesh(new THREE.SphereGeometry(0.82, 26, 26), makeMaterial(BLANK.body, 0.55));
    this.torso.scale.set(0.9, 1.1, 0.6); this.root.add(this.torso);

    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.34, 26, 26), makeMaterial(BLANK.body, 0.55));
    this.root.add(this.head);

    const eyeMat = new THREE.MeshBasicMaterial({ color: BLANK.eye });
    this.leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), eyeMat);
    this.rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 12), eyeMat);
    this.leftEye.position.set(-0.12, 0.05, 0.3);
    this.rightEye.position.set(0.12, 0.05, 0.3);
    this.head.add(this.leftEye, this.rightEye);

    // antenna = a floating orb the technique will bob
    this.antenna = new THREE.Group();
    this.antenna.position.set(0, 0.34, 0);
    this._orb = new THREE.Mesh(new THREE.SphereGeometry(0.08, 14, 14), makeMaterial(BLANK.trim, 0.4));
    this._orb.position.y = 0.16; this.antenna.add(this._orb);
    this.head.add(this.antenna);
  }

  // 2h — technique
  syncAttachedModel() {
    if (!this._orb) return;
    const t = (performance.now() - this.startedAt) / 1000;
    this._orb.position.y = 0.16 + Math.sin(t * 3) * 0.05;
  }

  // ...refreshMeta string and idle string say "MushyBlankExample ..."...
}
```

Register it (§6), build, verify, ship. Done — that's the whole craft.

---

*Maintainers: keep the variant count in §0 and the table in §5 up to date as new characters land.*
