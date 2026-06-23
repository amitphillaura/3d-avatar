import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { MushyAvatar } from "./avatar.js";
import { MIXAMO_LEFT_HAND_BONES, MIXAMO_RIGHT_HAND_BONES } from "./handRig.js";
import {
  findHeadBone,
  findHipsBone,
  findNeckBone,
  findSpineBone,
  getBoneMapForRig,
  resolveModelBone
} from "./mixamoRig.js";
import { MUSHY_FOOT_Y, MUSHY_HIP_Y } from "./poseSkeleton.js";

function midpoint(out, a, b) {
  return out.addVectors(a, b).multiplyScalar(0.5);
}

/** Same direction math as Mushy setCylinderBetween — applied to a skinned bone. */
function aimSegment(entry, start, end, dir, delta, desired, parentQuat) {
  dir.subVectors(end, start);
  if (dir.lengthSq() < 1e-6) return false;
  dir.normalize();
  delta.setFromUnitVectors(entry.restWorldDir, dir);
  desired.multiplyQuaternions(delta, entry.restWorldQuat);
  entry.bone.parent.getWorldQuaternion(parentQuat);
  parentQuat.invert();
  entry.bone.quaternion.multiplyQuaternions(parentQuat, desired);
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
    this.boneMap = options.boneMap || getBoneMapForRig(options.rig || "mixamo");
    this.defaultClip = options.defaultAnimation || "idle";
    this.onAnimationsLoaded = options.onAnimationsLoaded;
    this.showDebugSkeleton = !this.modelUrl || options.showDebugSkeleton === true;

    this.model = null;
    this.modelReady = false;
    this.modelLoading = false;
    this.limbEntries = [];
    this.handEntries = [];
    this.spineEntry = null;
    this.neckEntry = null;
    this.headBone = null;
    this.mixer = null;
    this.idleAction = null;
    this.clips = [];
    this.animationNames = [];

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
    this.handEntries = [];
    this.spineEntry = null;
    this.neckEntry = null;
    this.headBone = null;

    this.boneMap.forEach((entry) => {
      const bone = resolveModelBone(this.model, entry.bone);
      let child = resolveModelBone(this.model, entry.child);
      if (bone && !child) child = bone.children.find((node) => node.isBone);
      this.addSegmentEntry(bone, child, entry.from, entry.to, entry.limb, this.limbEntries);
    });

    if (!this.previewOnly) {
      ["left", "right"].forEach((side) => {
        const map = side === "left" ? MIXAMO_LEFT_HAND_BONES : MIXAMO_RIGHT_HAND_BONES;
        map.forEach(({ bone, child, from, to }) => {
          const boneObj = resolveModelBone(this.model, bone);
          let childObj = resolveModelBone(this.model, child);
          if (boneObj && !childObj) childObj = boneObj.children.find((node) => node.isBone);
          if (!boneObj || !childObj) return;
          const a = new THREE.Vector3();
          const b = new THREE.Vector3();
          boneObj.getWorldPosition(a);
          childObj.getWorldPosition(b);
          this.handEntries.push({
            side,
            from,
            to,
            bone: boneObj,
            restLocalQuat: boneObj.quaternion.clone(),
            restWorldQuat: boneObj.getWorldQuaternion(new THREE.Quaternion()),
            restWorldDir: b.sub(a).normalize()
          });
        });
      });
    }

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
      this.resetModelBindPose();
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

    if (this.headBone) {
      this.headBone.quaternion.copy(this.head.quaternion);
    }

    if (handTracking) {
      this.handEntries.forEach((entry) => {
        const rig = this.hands[entry.side];
        if (!rig?.active) {
          entry.bone.quaternion.slerp(entry.restLocalQuat, 0.18);
          return;
        }
        const ok = aimSegment(
          entry,
          rig.points.get(entry.from),
          rig.points.get(entry.to),
          this._dir,
          this._delta,
          this._desired,
          this._parentQuat
        );
        if (!ok) entry.bone.quaternion.slerp(entry.restLocalQuat, 0.18);
      });
    }

    this.model.updateMatrixWorld(true);
  }

  getModelWorldBox() {
    if (!this.model) return null;

    const box = new THREE.Box3();
    box.makeEmpty();
    this.model.updateMatrixWorld(true);
    this.model.traverse((node) => {
      if (!node.isMesh || !node.geometry) return;
      if (!node.geometry.boundingBox) node.geometry.computeBoundingBox();
      const meshBox = node.geometry.boundingBox.clone();
      meshBox.applyMatrix4(node.matrixWorld);
      box.union(meshBox);
    });

    if (box.isEmpty()) return null;
    const size = box.getSize(this._b);
    if (size.lengthSq() < 1e-4) return null;
    return box;
  }

  boxCornerPoints(box) {
    const { min, max } = box;
    return [
      new THREE.Vector3(min.x, min.y, min.z),
      new THREE.Vector3(max.x, min.y, min.z),
      new THREE.Vector3(min.x, max.y, min.z),
      new THREE.Vector3(max.x, max.y, min.z),
      new THREE.Vector3(min.x, min.y, max.z),
      new THREE.Vector3(max.x, min.y, max.z),
      new THREE.Vector3(min.x, max.y, max.z),
      new THREE.Vector3(max.x, max.y, max.z)
    ];
  }

  frameBodyCamera() {
    if (this.framedViewport && this.modelReady && this.model) {
      const trackingPoints = this.collectFramingPoints();
      if (trackingPoints.length) {
        // Landmarks span wider than the skinned mesh — tighten to match visible body size.
        this.frameCameraToPoints(trackingPoints, { spanScale: 0.68 });
        return;
      }

      const box = this.getModelWorldBox();
      if (box) {
        this.frameCameraToPoints(this.boxCornerPoints(box));
        return;
      }
    }

    super.frameBodyCamera();
  }

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

      this.resetModelBindPose();
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
