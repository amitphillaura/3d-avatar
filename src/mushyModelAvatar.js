import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Pose as KalidoPose } from "kalidokit";
import { MushyAvatar } from "./avatar.js";
import {
  findHeadBone,
  findHipsBone,
  findNeckBone,
  findSpineBone,
  getBoneMapForRig,
  resolveModelBone
} from "./mixamoRig.js";
import { MUSHY_FOOT_Y, MUSHY_HIP_Y } from "./poseSkeleton.js";

// Maps Kalidokit's VRM-named output to Mixamo/Meshy bone candidates.
// resolveModelBone tries each name in order and returns the first match.
// Works for both Mixamo (mixamorigX names) and Meshy (shorthand names).
const KALIDOKIT_BONE_DEFS = [
  ["RightUpperArm",  "mixamorigRightArm",    "RightArm"],
  ["RightLowerArm",  "mixamorigRightForeArm", "RightForeArm"],
  ["RightHand",      "mixamorigRightHand",    "RightHand"],
  ["LeftUpperArm",   "mixamorigLeftArm",      "LeftArm"],
  ["LeftLowerArm",   "mixamorigLeftForeArm",  "LeftForeArm"],
  ["LeftHand",       "mixamorigLeftHand",     "LeftHand"],
  ["Spine",          "mixamorigSpine",        "Spine"],
  ["Hips",           "mixamorigHips",         "Hips"],
  ["RightUpperLeg",  "mixamorigRightUpLeg",   "RightUpLeg"],
  ["RightLowerLeg",  "mixamorigRightLeg",     "RightLeg"],
  ["LeftUpperLeg",   "mixamorigLeftUpLeg",    "LeftUpLeg"],
  ["LeftLowerLeg",   "mixamorigLeftLeg",      "LeftLeg"],
];

// Kalidokit emits rotations in VRM (0.x, -Z-facing) convention; Mixamo/Meshy rigs face +Z.
// A 180-deg rotation about Y reconciles the two world frames. Determined empirically against
// the bundled Mixamo rig (scripts/retarget-probe.mjs): of {I, Ry180, Rx180, Rz180}, only
// Ry180 makes a raised arm go up AND a forward arm go toward camera, on both sides.
const KALIDO_AXIS_FIX = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI);
const KALIDO_AXIS_FIX_INV = KALIDO_AXIS_FIX.clone().invert();

function midpoint(out, a, b) {
  return out.addVectors(a, b).multiplyScalar(0.5);
}

// MediaPipe hand-landmark index of the proximal (base) joint of each finger.
const FINGER_BASE = { thumb: 1, index: 5, middle: 9, ring: 13, pinky: 17 };
// Hand-landmark indices used to orient the wrist/hand bone (wrist -> middle MCP).
const WRIST_FROM = 0;
const WRIST_TO = 9;

/** Classify a bone name into a finger (rig-agnostic: Mixamo, Meshy, Rigify, ...). */
function classifyFinger(name) {
  const n = name.toLowerCase();
  if (n.includes("thumb")) return "thumb";
  if (n.includes("index")) return "index";
  if (n.includes("middle")) return "middle";
  if (n.includes("ring")) return "ring";
  if (n.includes("pinky") || n.includes("little")) return "pinky";
  return null;
}

/** Hierarchy depth of `node` below `ancestor` (Infinity if not a descendant). */
function depthFrom(ancestor, node) {
  let depth = 0;
  let cur = node;
  while (cur && cur !== ancestor) {
    cur = cur.parent;
    depth += 1;
  }
  return cur === ancestor ? depth : Infinity;
}

/**
 * Same direction math as Mushy setCylinderBetween — applied to a skinned bone.
 * `blend` < 1 slerps toward the target instead of snapping (used to damp noisy hands).
 */
function aimSegment(entry, start, end, dir, delta, desired, parentQuat, blend = 1) {
  dir.subVectors(end, start);
  if (dir.lengthSq() < 1e-6) return false;
  dir.normalize();
  delta.setFromUnitVectors(entry.restWorldDir, dir);
  desired.multiplyQuaternions(delta, entry.restWorldQuat);
  entry.bone.parent.getWorldQuaternion(parentQuat);
  parentQuat.invert();
  desired.premultiply(parentQuat); // world target -> bone-local target
  if (blend >= 1) entry.bone.quaternion.copy(desired);
  else entry.bone.quaternion.slerp(desired, blend);
  return true;
}

/**
 * Optional GLB skin parented to the Mushy root.
 * Pose = identical joint points + segment directions as the Mushy cylinders.
 */
export class MushyModelAvatar extends MushyAvatar {
  constructor(mount, metaElement, options = {}) {
    super(mount, metaElement, {
      framedViewport: options.framedViewport ?? mount?.id === "riggedModelMount"
    });
    this.modelUrl = options.url || null;
    this.previewOnly = Boolean(options.previewOnly);
    this.rig = options.rig || "mixamo";
    this.boneMap = options.boneMap || getBoneMapForRig(this.rig);
    this.defaultClip = options.defaultAnimation || "idle";
    this.onAnimationsLoaded = options.onAnimationsLoaded;
    this.showDebugSkeleton = !this.modelUrl || options.showDebugSkeleton === true;
    // Hands are wrist-only by default (stable). Fingers are opt-in (noisy MediaPipe data).
    this.trackFingers = Boolean(options.trackFingers);

    this.model = null;
    this.modelReady = false;
    this.modelLoading = false;
    this.limbEntries = [];
    this.wristEntries = [];
    this.fingerEntries = [];
    this.kalidoBones = [];
    this.spineEntry = null;
    this.neckEntry = null;
    this.headBone = null;
    this.mixer = null;
    this.idleAction = null;
    this.clips = [];
    this.animationNames = [];

    // Kalidokit inputs — captured each frame in updateTracking().
    this.worldLandmarks = null;  // results.ea — metric 3D world coords (fixes depth noise)
    this.rawPoseLandmarks = null; // normalized 2D pose landmarks
    this.lastVideo = null;        // video element for Kalidokit image-size inference

    this._dir = new THREE.Vector3();
    this._a = new THREE.Vector3();
    this._b = new THREE.Vector3();
    this._delta = new THREE.Quaternion();
    this._desired = new THREE.Quaternion();
    this._parentQuat = new THREE.Quaternion();
    this._bindRest = [];

    this.loader = new GLTFLoader();
    if (this.modelUrl) this.loadModel(this.modelUrl);
    else this.applySkeletonVisibility();
  }

  updateTracking(payload) {
    // Capture Kalidokit inputs before the base class processes landmarks.
    this.worldLandmarks = payload?.worldLandmarks || null;
    this.rawPoseLandmarks = payload?.poseLandmarks || null;
    this.lastVideo = payload?.media?.video || null;
    super.updateTracking(payload);
  }

  setAnimation(clipName) {
    if (!this.mixer || !clipName) return false;
    const clip = this.clips.find((entry) => entry.name === clipName);
    if (!clip) return false;
    if (this.idleAction) this.idleAction.stop();
    this.idleAction = this.mixer.clipAction(clip);
    this.idleAction.reset().play();
    return true;
  }

  loadModel(url) {
    if (this.modelLoading) return;
    this.modelLoading = true;
    this.metaElement.textContent = "Loading model on Mushy skeleton...";

    this.loader.load(
      url,
      (gltf) => {
        this.modelLoading = false;
        if (this.model) {
          this.root.remove(this.model);
          this.disposeModelGraph(this.model);
        }

        this.model = gltf.scene;
        this.root.add(this.model);
        this.clips = gltf.animations || [];
        this.animationNames = this.clips.map((clip) => clip.name);
        this.mixer = this.clips.length ? new THREE.AnimationMixer(this.model) : null;

        this.fitModelToSkeleton();
        this.captureBindPose();
        this.buildBoneEntries();
        this.resetModelBindPose();

        const defaultClip = this.pickDefaultClip();
        this.modelReady = true;
        this.applySkeletonVisibility();
        this.metaElement.textContent = this.previewOnly
          ? `Preview · ${this.limbEntries.length} limb bones`
          : `Mushy skeleton · ${this.limbEntries.length} bones · rest pose`;
        this.onAnimationsLoaded?.(this.animationNames.slice(), defaultClip);
        this.resize();
      },
      undefined,
      (err) => {
        this.modelLoading = false;
        console.error("Mushy model load failed:", err);
        this.metaElement.textContent = "Failed to load model";
        this.onAnimationsLoaded?.([], null);
      }
    );
  }

  pickDefaultClip() {
    if (!this.animationNames.length) return null;
    if (this.animationNames.includes(this.defaultClip)) return this.defaultClip;
    const idle = this.animationNames.find((name) => /idle/i.test(name));
    return idle || this.animationNames[0];
  }

  fitModelToSkeleton() {
    this.model.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(this.model);
    const size = box.getSize(new THREE.Vector3());
    const scale = 1.85 / Math.max(size.y, 0.001);
    this.model.scale.setScalar(scale);
    this.model.position.set(0, 0, 0);
    this.model.updateMatrixWorld(true);

    const hips = findHipsBone(this.model);
    if (hips) {
      const hipWorld = new THREE.Vector3();
      hips.getWorldPosition(hipWorld);
      this.model.position.y = MUSHY_HIP_Y - hipWorld.y;
      return;
    }

    box.setFromObject(this.model);
    this.model.position.set(0, -box.min.y + MUSHY_FOOT_Y, 0);
  }

  captureBindPose() {
    this._bindRest.length = 0;
    this.model.traverse((node) => {
      if (node.isBone) {
        this._bindRest.push({ bone: node, quat: node.quaternion.clone() });
      }
    });
  }

  resetModelBindPose() {
    this._bindRest.forEach(({ bone, quat }) => bone.quaternion.copy(quat));
    if (this.model) this.model.updateMatrixWorld(true);
  }

  addSegmentEntry(bone, child, from, to, limb, list) {
    if (!bone || !child) return;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    bone.getWorldPosition(a);
    child.getWorldPosition(b);
    list.push({
      from,
      to,
      limb,
      bone,
      restLocalQuat: bone.quaternion.clone(),
      restWorldQuat: bone.getWorldQuaternion(new THREE.Quaternion()),
      restWorldDir: b.sub(a).normalize()
    });
  }

  buildBoneEntries() {
    this.limbEntries = [];
    this.wristEntries = [];
    this.fingerEntries = [];
    this.spineEntry = null;
    this.neckEntry = null;
    this.headBone = null;

    this.boneMap.forEach((entry) => {
      const bone = resolveModelBone(this.model, entry.bone);
      let child = resolveModelBone(this.model, entry.child);
      if (bone && !child) child = bone.children.find((node) => node.isBone);
      this.addSegmentEntry(bone, child, entry.from, entry.to, entry.limb, this.limbEntries);
    });

    if (!this.previewOnly) this.buildHandEntries();

    // Build Kalidokit bone map: VRM output key → Three.js bone object.
    // resolveModelBone tries each candidate name, so Mixamo and Meshy both work.
    // Capture each bone's BIND-POSE parent world quaternion (Wp) and rest local quaternion
    // (L_rest). These drive the three-vrm normalized->raw change-of-basis in _driveKalidokit.
    // The model is in its rest pose here (captureBindPose ran; resetModelBindPose hasn't),
    // and fitModelToSkeleton already called updateMatrixWorld, so world quats are valid.
    this.kalidoBones = KALIDOKIT_BONE_DEFS.flatMap(([vrmKey, ...names]) => {
      const bone = names.reduce((found, n) => found || resolveModelBone(this.model, n), null);
      if (!bone) return [];
      const parentWorld = new THREE.Quaternion();
      (bone.parent || this.model).getWorldQuaternion(parentWorld);
      return [{
        vrmKey,
        bone,
        parentWorld,
        parentWorldInv: parentWorld.clone().invert(),
        restLocal: bone.quaternion.clone()
      }];
    });

    const spine = findSpineBone(this.model);
    const spineChild =
      resolveModelBone(this.model, "mixamorigSpine1") ||
      resolveModelBone(this.model, "Spine1") ||
      findNeckBone(this.model);
    if (spine && spineChild) {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      spine.getWorldPosition(a);
      spineChild.getWorldPosition(b);
      this.spineEntry = {
        bone: spine,
        restLocalQuat: spine.quaternion.clone(),
        restWorldQuat: spine.getWorldQuaternion(new THREE.Quaternion()),
        restWorldDir: b.sub(a).normalize()
      };
    }

    const neck = findNeckBone(this.model);
    const head = findHeadBone(this.model);
    if (neck && head) {
      const a = new THREE.Vector3();
      const b = new THREE.Vector3();
      neck.getWorldPosition(a);
      head.getWorldPosition(b);
      this.neckEntry = {
        bone: neck,
        restLocalQuat: neck.quaternion.clone(),
        restWorldQuat: neck.getWorldQuaternion(new THREE.Quaternion()),
        restWorldDir: b.sub(a).normalize()
      };
      this.headBone = head;
    }
  }

  findHandBone(side) {
    const candidates =
      side === "left"
        ? ["mixamorigLeftHand", "mixamorig:LeftHand", "LeftHand", "hand.L", "DEF-handL", "Hand_L"]
        : ["mixamorigRightHand", "mixamorig:RightHand", "RightHand", "hand.R", "DEF-handR", "Hand_R"];
    for (const name of candidates) {
      const bone = resolveModelBone(this.model, name);
      if (bone) return bone;
    }
    // Fuzzy fallback: a bone named like a hand on the correct side, with finger children.
    let found = null;
    this.model.traverse((node) => {
      if (found || !node.isBone) return;
      const n = node.name.toLowerCase();
      const sideOk = side === "left" ? n.includes("left") || /(^|_|\.)l($|_|\.)/.test(n) : n.includes("right") || /(^|_|\.)r($|_|\.)/.test(n);
      if (n.includes("hand") && sideOk) found = node;
    });
    return found;
  }

  // Rig-agnostic hand rig: scan each hand bone's subtree, group bones by finger, and
  // build a wrist entry (always driven) plus per-finger entries (driven only when
  // trackFingers is on). Works for Mixamo, Meshy, Rigify, etc. without hardcoded names.
  buildHandEntries() {
    this.wristEntries = [];
    this.fingerEntries = [];
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();

    ["left", "right"].forEach((side) => {
      const hand = this.findHandBone(side);
      if (!hand) return;

      const groups = { thumb: [], index: [], middle: [], ring: [], pinky: [] };
      hand.traverse((node) => {
        if (!node.isBone || node === hand) return;
        const finger = classifyFinger(node.name);
        if (finger) groups[finger].push(node);
      });

      // Wrist: orient the hand bone toward its finger fan (reference = middle/any root).
      const refChild =
        groups.middle[0] ||
        groups.index[0] ||
        groups.ring[0] ||
        groups.pinky[0] ||
        hand.children.find((node) => node.isBone);
      if (refChild) {
        hand.getWorldPosition(a);
        refChild.getWorldPosition(b);
        const dir = b.clone().sub(a);
        if (dir.lengthSq() > 1e-8) {
          this.wristEntries.push({
            side,
            kind: "wrist",
            bone: hand,
            restLocalQuat: hand.quaternion.clone(),
            restWorldQuat: hand.getWorldQuaternion(new THREE.Quaternion()),
            restWorldDir: dir.normalize()
          });
        }
      }

      // Fingers: sort each chain root->tip, map joint i to landmark (base+i -> base+i+1).
      Object.entries(groups).forEach(([finger, bones]) => {
        if (!bones.length) return;
        bones.sort((x, y) => depthFrom(hand, x) - depthFrom(hand, y));
        const base = FINGER_BASE[finger];
        for (let i = 0; i < bones.length; i += 1) {
          const bone = bones[i];
          const child = bones[i + 1] || bone.children.find((node) => node.isBone);
          if (!child) continue;
          bone.getWorldPosition(a);
          child.getWorldPosition(b);
          const dir = b.clone().sub(a);
          if (dir.lengthSq() < 1e-8) continue;
          this.fingerEntries.push({
            side,
            kind: "finger",
            from: base + i,
            to: base + i + 1,
            bone,
            restLocalQuat: bone.quaternion.clone(),
            restWorldQuat: bone.getWorldQuaternion(new THREE.Quaternion()),
            restWorldDir: dir.normalize()
          });
        }
      });
    });
  }

  setTrackFingers(value) {
    this.trackFingers = Boolean(value);
  }

  /**
   * Apply Kalidokit.Pose.solve() rotations to the mapped GLB bones.
   *
   * Kalidokit feeds POSE_WORLD_LANDMARKS (results.ea) as lm3d, which gives
   * metric-scale 3D coords with hips at origin — eliminating the depth noise
   * that caused hands to clip into the torso with the old swing-only solver.
   * Its internal rigArm/rigLegs functions also add anatomical clamping and
   * stabilisation that the setFromUnitVectors approach lacked.
   *
   * Kalidokit outputs rotations in VRM bone-local space.  For Mixamo/Meshy
   * models exported from a T-pose the bind quaternions are near-identity, so
   * the VRM-convention eulers apply directly with no change-of-basis.
   *
   * Returns true when at least some rotations were applied.
   */
  _driveKalidokit() {
    if (!this.kalidoBones.length || !this.worldLandmarks || !this.rawPoseLandmarks) return false;
    if (this.worldLandmarks.length < 17 || this.rawPoseLandmarks.length < 17) return false;

    let solved;
    try {
      solved = KalidoPose.solve(this.worldLandmarks, this.rawPoseLandmarks, {
        runtime: "mediapipe",
        video: this.lastVideo || undefined,
        enableLegs: true
      });
    } catch {
      return false;
    }
    if (!solved) return false;

    const _e = new THREE.Euler(0, 0, 0, "XYZ");
    const _rk = new THREE.Quaternion();
    const _target = new THREE.Quaternion();
    this.kalidoBones.forEach(({ vrmKey, bone, parentWorld, parentWorldInv, restLocal }) => {
      // Hips has a nested { position, rotation } shape; everything else is a plain Vector3.
      const rot = vrmKey === "Hips" ? solved.Hips?.rotation : solved[vrmKey];
      if (!rot) return;
      _e.set(rot.x, rot.y, rot.z, "XYZ");
      _rk.setFromEuler(_e);
      // Re-express the VRM-frame rotation in the rig's world frame: R_k2 = C * R_k * C^-1.
      _rk.premultiply(KALIDO_AXIS_FIX).multiply(KALIDO_AXIS_FIX_INV);
      // three-vrm normalized->raw change-of-basis. Literal verified method-chain order
      // (VRMHumanoidRig.ts): target = Wp^-1 * R_k2 * Wp * L_rest. For an identity-bind rig
      // (Mixamo) this collapses to R_k2; for Meshy it applies the real rest offsets.
      _target.copy(_rk).multiply(parentWorld).premultiply(parentWorldInv).multiply(restLocal);
      bone.quaternion.slerp(_target, 0.45);
    });

    return true;
  }

  footEnd(side, out) {
    const heel = side === "left" ? "leftHeel" : "rightHeel";
    const toe = side === "left" ? "leftFootIndex" : "rightFootIndex";
    if (this.activePoints.has(heel) && this.activePoints.has(toe)) {
      return midpoint(out, this.points.get(heel), this.points.get(toe));
    }
    if (this.activePoints.has(toe)) return out.copy(this.points.get(toe));
    if (this.activePoints.has(heel)) return out.copy(this.points.get(heel));
    return null;
  }

  segmentVisible(from, to) {
    return this.activePoints.has(from) && this.activePoints.has(to);
  }

  applySkeletonVisibility() {
    if (this.showDebugSkeleton || !this.modelReady) return;
    this.joints.forEach((joint) => {
      joint.visible = false;
    });
    this.bones.forEach(({ mesh }) => {
      mesh.visible = false;
    });
    Object.values(this.caps).forEach((cap) => {
      cap.visible = false;
    });
    if (this.torso) this.torso.visible = false;
    if (this.neck) this.neck.visible = false;
    if (this.head) this.head.visible = false;
    Object.values(this.hands).forEach((rig) => {
      rig.segments.forEach(({ mesh }) => {
        mesh.visible = false;
      });
      rig.tips.forEach((tip) => {
        tip.visible = false;
      });
    });
  }

  driveModelFromSkeleton() {
    if (!this.modelReady || this.previewOnly) return;

    const bodyTracking = performance.now() - this.latestTrackedAt <= 900;
    const handTracking = this.isAnyHandActive();
    if (!bodyTracking && !handTracking && !this.isFaceActive()) {
      // Paused / brief dropout (was tracked): HOLD the last pose so the character
      // doesn't snap to a T-pose. Only fall back to bind pose on an explicit clear.
      if (this.latestTrackedAt === 0) this.resetModelBindPose();
      return;
    }

    const hasCore = ["leftShoulder", "rightShoulder", "leftHip", "rightHip"].every((name) =>
      this.activePoints.has(name)
    );

    if (bodyTracking && hasCore && this.spineEntry) {
      midpoint(this._a, this.points.get("leftHip"), this.points.get("rightHip"));
      midpoint(this._b, this.points.get("leftShoulder"), this.points.get("rightShoulder"));
      aimSegment(
        this.spineEntry,
        this._a,
        this._b,
        this._dir,
        this._delta,
        this._desired,
        this._parentQuat
      );
    }

    if (bodyTracking) {
      this.limbEntries.forEach((entry) => {
        let start;
        let end;

        if (entry.limb === "foot") {
          const side = entry.from.startsWith("left") ? "left" : "right";
          if (!this.activePoints.has(entry.from)) {
            entry.bone.quaternion.slerp(entry.restLocalQuat, 0.2);
            return;
          }
          start = this.points.get(entry.from);
          end = this.footEnd(side, this._b);
          if (!end) {
            entry.bone.quaternion.slerp(entry.restLocalQuat, 0.2);
            return;
          }
        } else if (this.segmentVisible(entry.from, entry.to)) {
          start = this.points.get(entry.from);
          end = this.points.get(entry.to);
        } else {
          entry.bone.quaternion.slerp(entry.restLocalQuat, 0.2);
          return;
        }

        if (
          !aimSegment(entry, start, end, this._dir, this._delta, this._desired, this._parentQuat)
        ) {
          entry.bone.quaternion.slerp(entry.restLocalQuat, 0.2);
        }
      });
    }

    if (this.neckEntry && this.neck.visible && hasCore) {
      midpoint(this._a, this.points.get("leftShoulder"), this.points.get("rightShoulder"));
      aimSegment(
        this.neckEntry,
        this._a,
        this.head.position,
        this._dir,
        this._delta,
        this._desired,
        this._parentQuat
      );
    }

    // Head bone is left to follow the neck. (The old code copied this.head's local
    // quaternion — built for the procedural sphere parented to root — straight onto the
    // GLB head bone parented to the neck, which is a coordinate-space mismatch and made
    // the head face the wrong way.)

    if (handTracking) {
      const driveHand = (entry, blend) => {
        const rig = this.hands[entry.side];
        if (!rig?.active) {
          entry.bone.quaternion.slerp(entry.restLocalQuat, 0.2);
          return;
        }
        const from = entry.kind === "wrist" ? WRIST_FROM : entry.from;
        const to = entry.kind === "wrist" ? WRIST_TO : entry.to;
        const ok = aimSegment(
          entry,
          rig.points.get(from),
          rig.points.get(to),
          this._dir,
          this._delta,
          this._desired,
          this._parentQuat,
          blend
        );
        if (!ok) entry.bone.quaternion.slerp(entry.restLocalQuat, 0.2);
      };

      // Wrist always (stable). Fingers only when opted in; otherwise relax to rest.
      this.wristEntries.forEach((entry) => driveHand(entry, 0.5));
      if (this.trackFingers) {
        this.fingerEntries.forEach((entry) => driveHand(entry, 0.35));
      } else {
        this.fingerEntries.forEach((entry) => entry.bone.quaternion.slerp(entry.restLocalQuat, 0.25));
      }
    }

    // Kalidokit pass: runs AFTER aimSegment so its result wins for covered bones.
    // Uses world landmarks (metric 3D) for correct depth — fixes hands-in-body.
    if (!this.previewOnly) this._driveKalidokit();

    this.model.updateMatrixWorld(true);
  }

  // Camera framing is inherited from MushyAvatar.frameBodyCameraFixed() — a constant,
  // jitter-free full-body frame. (The old override re-fit the noisy landmark/mesh
  // bounding box every frame, which is what made the hero camera "zoom all over".)

  animateIdle(delta) {
    const live =
      performance.now() - this.latestTrackedAt <= 900 ||
      this.isFaceActive() ||
      this.isAnyHandActive();

    if (this.modelReady) {
      this.root.rotation.y = 0;
      this.root.position.y = -0.15;

      if (live) {
        if (this.idleAction?.isRunning()) this.idleAction.stop();
        return;
      }

      if (this.idleAction?.isRunning() && this.mixer) {
        this.mixer.update(delta);
        return;
      }

      // Not live and no idle clip: reset to bind only on an explicit clear; otherwise
      // hold the last tracked pose so a paused video / brief dropout doesn't T-pose.
      if (this.latestTrackedAt === 0 && this.latestFaceTrackedAt === 0) {
        this.resetModelBindPose();
      }
      return;
    }

    super.animateIdle(delta);
  }

  syncAttachedModel(_delta) {
    if (!this.modelReady) return;
    this.applySkeletonVisibility();
    this.driveModelFromSkeleton();
  }

  disposeModelGraph(object) {
    object.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        const materials = Array.isArray(child.material) ? child.material : [child.material];
        materials.forEach((material) => material.dispose());
      }
    });
  }

  dispose() {
    if (this.mixer) this.mixer.stopAllAction();
    if (this.model) {
      this.root.remove(this.model);
      this.disposeModelGraph(this.model);
      this.model = null;
    }
    super.dispose();
  }
}
