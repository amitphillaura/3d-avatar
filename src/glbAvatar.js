import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OneEuro } from "./avatar.js";
import { solveFaceRig } from "./faceRig.js";
import {
  MIXAMO_LEFT_HAND_BONES,
  MIXAMO_RIGHT_HAND_BONES,
  isHandTracked
} from "./handRig.js";
import {
  applyJointSwingTwist,
  CHAIN_AXES,
  createChainItem
} from "./swingTwistRetarget.js";
import {
  MIXAMO_BONE_MAP,
  findHeadBone,
  findHipsBone,
  findNeckBone,
  findSpineBone,
  resolveModelBone
} from "./mixamoRig.js";
import {
  hipLineYaw,
  mapHandLandmark,
  mapPoseLandmark,
  POSE_LM,
  shoulderTwistYaw,
  writeNeckDirection,
  writeSegmentDirection,
  writeTorsoDirection
} from "./poseSkeleton.js";

export { MIXAMO_BONE_MAP };

const LM = POSE_LM;

const LEG_LANDMARKS = new Set([
  "leftHip",
  "rightHip",
  "leftKnee",
  "rightKnee",
  "leftAnkle",
  "rightAnkle",
  "leftHeel",
  "rightHeel",
  "leftFootIndex",
  "rightFootIndex"
]);

const SWAP_LR = false;

function opposite(name) {
  return name.startsWith("left") ? name.replace("left", "right") : name.replace("right", "left");
}

function landmarkVisible(landmark, minVisibility = 0.4) {
  return Boolean(landmark && (landmark.visibility ?? 1) > minVisibility);
}

export class CharacterAvatar {
  constructor(mount, metaElement, options = {}) {
    this.mount = mount;
    this.metaElement = metaElement;
    this.modelUrl = options.url || "/models/character.glb";
    this.modelId = options.id || "character";
    this.boneMap = options.boneMap || MIXAMO_BONE_MAP;
    this.defaultClip = options.defaultAnimation || "idle";
    this.onAnimationsLoaded = options.onAnimationsLoaded;

    this.startedAt = performance.now();
    this.lastFrameAt = this.startedAt;
    this.latestTrackedAt = 0;
    this.latestFaceTrackedAt = 0;
    this.faceRig = null;
    this.stopped = false;
    this.paused = false;
    this.ready = false;
    this.loading = false;
    this.clips = [];
    this.animationNames = [];
    this.activeClip = null;

    this.targets = new Map();
    this.smooth = new Map();
    this.filters = new Map();
    Object.keys(LM).forEach((name) => {
      this.targets.set(name, new THREE.Vector3());
      this.smooth.set(name, new THREE.Vector3());
      this.filters.set(name, {
        x: new OneEuro({ minCutoff: 1.4, beta: 0.012 }),
        y: new OneEuro({ minCutoff: 1.4, beta: 0.012 }),
        z: new OneEuro({ minCutoff: 0.7, beta: 0.006 })
      });
    });
    this.haveSmooth = false;
    this.visibleNow = new Set();
    this.handBones = [];
    this.handTargets = {
      left: new Map(),
      right: new Map()
    };
    this.handSmooth = {
      left: new Map(),
      right: new Map()
    };
    this.handFilters = {
      left: new Map(),
      right: new Map()
    };
    this.handVisible = {
      left: new Set(),
      right: new Set()
    };
    this.latestHandTrackedAt = { left: 0, right: 0 };

    ["left", "right"].forEach((side) => {
      for (let index = 0; index < 21; index += 1) {
        this.handTargets[side].set(index, new THREE.Vector3());
        this.handSmooth[side].set(index, new THREE.Vector3());
        this.handFilters[side].set(index, {
          x: new OneEuro({ minCutoff: 2.8, beta: 0.035 }),
          y: new OneEuro({ minCutoff: 2.8, beta: 0.035 }),
          z: new OneEuro({ minCutoff: 1.8, beta: 0.015 })
        });
      }
    });

    this._mapped = new THREE.Vector3();
    this._hipMid = new THREE.Vector3();
    this._shMid = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._neckBase = new THREE.Vector3();
    this._neckTip = new THREE.Vector3();
    this._shoulderLine = new THREE.Vector3();
    this._hipLine = new THREE.Vector3();
    this._targetDir = new THREE.Vector3();
    this._delta = new THREE.Quaternion();
    this._parentQuat = new THREE.Quaternion();
    this._desired = new THREE.Quaternion();
    this._targetQuat = new THREE.Quaternion();
    this._axisZ = new THREE.Vector3(0, 0, 1);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06080e);

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    this.camera.position.set(0, 1.4, 4.2);
    this.camera.lookAt(0, 1.1, 0);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance"
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mount.appendChild(this.renderer.domElement);

    this.loader = new GLTFLoader();
    this.createLights();
    this.createWorld();
    this.loadCharacter(this.modelUrl);
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    this.animate();
  }

  createLights() {
    this.scene.add(new THREE.HemisphereLight(0x9eefff, 0x101624, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(3, 5, 4);
    this.scene.add(key);
    const rim = new THREE.PointLight(0x00f0a8, 5.5, 14);
    rim.position.set(-2.4, 2.2, 3);
    this.scene.add(rim);
  }

  createWorld() {
    const grid = new THREE.GridHelper(6.4, 16, 0x214053, 0x182431);
    grid.material.transparent = true;
    grid.material.opacity = 0.42;
    this.scene.add(grid);
  }

  clearModel() {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.idleAction = null;
    this.bones = [];
    this.handBones = [];
    this.neckChainItem = null;
    this.spineRetarget = null;
    this.clips = [];
    this.spine = null;
    this.spineRest = null;
    this.hips = null;
    this.hipsRest = null;
    this.neck = null;
    this.neckRest = null;
    this.neckRetarget = null;
    this.head = null;
    this.headRest = null;
    this.animationNames = [];
    this.activeClip = null;
    this.ready = false;
    this.haveSmooth = false;
    if (this.model) {
      this.scene.remove(this.model);
      this.model.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          const materials = Array.isArray(child.material) ? child.material : [child.material];
          materials.forEach((material) => material.dispose());
        }
      });
      this.model = null;
    }
  }

  pickDefaultClip() {
    if (!this.animationNames.length) return null;
    if (this.animationNames.includes(this.defaultClip)) return this.defaultClip;
    const idle = this.animationNames.find((name) => /idle/i.test(name));
    return idle || this.animationNames[0];
  }

  setAnimation(clipName) {
    if (!this.mixer || !clipName) return false;
    const clip = this.clips.find((entry) => entry.name === clipName);
    if (!clip) return false;
    if (this.idleAction) this.idleAction.stop();
    this.idleAction = this.mixer.clipAction(clip);
    this.idleAction.reset().play();
    this.activeClip = clipName;
    return true;
  }

  loadCharacter(url) {
    if (this.loading) return;
    this.loading = true;
    this.modelUrl = url;
    this.clearModel();
    this.metaElement.textContent = "Loading model...";

    this.loader.load(
      url,
      (gltf) => {
        this.loading = false;
        this.model = gltf.scene;
        this.model.position.set(0, 0, 0);
        this.model.rotation.set(0, 0, 0);
        this.scene.add(this.model);
        this.clips = gltf.animations;
        this.animationNames = gltf.animations.map((clip) => clip.name);

        this.bones = [];
        this.handBones = [];
        this.model.updateMatrixWorld(true);
        this.boneMap.forEach((entry) => {
          const bone = resolveModelBone(this.model, entry.bone);
          let child = resolveModelBone(this.model, entry.child);
          if (bone && !child) {
            child = bone.children.find((node) => node.isBone);
          }
          if (!bone || !child) return;

          const boneWorld = new THREE.Vector3();
          const childWorld = new THREE.Vector3();
          bone.getWorldPosition(boneWorld);
          child.getWorldPosition(childWorld);
          this.bones.push({
            bone,
            from: entry.from,
            to: entry.to,
            limb: entry.limb,
            restLocalQuat: bone.quaternion.clone(),
            restWorldQuat: bone.getWorldQuaternion(new THREE.Quaternion()),
            restWorldDir: childWorld.sub(boneWorld).normalize()
          });
        });

        this.registerHandBones("left", MIXAMO_LEFT_HAND_BONES);
        this.registerHandBones("right", MIXAMO_RIGHT_HAND_BONES);

        this.hips = findHipsBone(this.model);
        this.hipsRest = this.hips ? this.hips.quaternion.clone() : null;
        this.spine = findSpineBone(this.model);
        this.spineRest = this.spine ? this.spine.quaternion.clone() : null;
        this.spineRetarget = null;
        if (this.spine) {
          const spineChild =
            resolveModelBone(this.model, "mixamorigSpine1") ||
            resolveModelBone(this.model, "mixamorigSpine2") ||
            resolveModelBone(this.model, "Spine1") ||
            findNeckBone(this.model);
          if (spineChild) {
            const spineWorld = new THREE.Vector3();
            const childWorld = new THREE.Vector3();
            this.spine.getWorldPosition(spineWorld);
            spineChild.getWorldPosition(childWorld);
            this.spineRetarget = {
              bone: this.spine,
              restLocalQuat: this.spine.quaternion.clone(),
              restWorldQuat: this.spine.getWorldQuaternion(new THREE.Quaternion()),
              restWorldDir: childWorld.sub(spineWorld).normalize()
            };
          }
        }
        this.neck = findNeckBone(this.model);
        this.neckRest = this.neck ? this.neck.quaternion.clone() : null;
        this.head = findHeadBone(this.model);
        this.headRest = this.head ? this.head.quaternion.clone() : null;
        this.neckRetarget = null;
        if (this.neck && this.head) {
          const neckWorld = new THREE.Vector3();
          const headWorld = new THREE.Vector3();
          this.neck.getWorldPosition(neckWorld);
          this.head.getWorldPosition(headWorld);
          this.neckRetarget = {
            bone: this.neck,
            restLocalQuat: this.neck.quaternion.clone(),
            restWorldQuat: this.neck.getWorldQuaternion(new THREE.Quaternion()),
            restWorldDir: headWorld.sub(neckWorld).normalize()
          };
        }

        this.mixer = new THREE.AnimationMixer(this.model);
        this.activeClip = this.pickDefaultClip();
        this.idleAction = null;
        this.resetToRestPose();
        this.neckChainItem = this.neck ? createChainItem(this.neck, CHAIN_AXES.head) : null;

        this.ready = this.bones.length > 0;
        const fingerCount = this.handBones.length;
        const neckLabel = this.neckChainItem ? " · neck" : "";
        this.metaElement.textContent = this.ready
          ? `${this.bones.length} bones · ${fingerCount} fingers · ${this.animationNames.length} clips${neckLabel}`
          : this.animationNames.length
            ? `${this.animationNames.length} clips · no rig bones`
            : "Loaded · no animations";
        this.onAnimationsLoaded?.(this.animationNames.slice(), this.activeClip);
      },
      undefined,
      (err) => {
        this.loading = false;
        console.error("Character load failed:", err);
        this.metaElement.textContent = "Failed to load";
        this.onAnimationsLoaded?.([], null);
      }
    );
  }

  registerHandBones(side, entries) {
    if (!this.model) return;
    entries.forEach(({ bone, child, from, to }) => {
      const boneObj = resolveModelBone(this.model, bone);
      let childObj = resolveModelBone(this.model, child);
      if (boneObj && !childObj) {
        childObj = boneObj.children.find((node) => node.isBone);
      }
      if (!boneObj || !childObj) return;
      const boneWorld = new THREE.Vector3();
      const childWorld = new THREE.Vector3();
      boneObj.getWorldPosition(boneWorld);
      childObj.getWorldPosition(childWorld);
      this.handBones.push({
        side,
        bone: boneObj,
        from,
        to,
        restLocalQuat: boneObj.quaternion.clone(),
        restWorldQuat: boneObj.getWorldQuaternion(new THREE.Quaternion()),
        restWorldDir: childWorld.sub(boneWorld).normalize()
      });
    });
  }

  mapLandmark(lm, out = this._mapped) {
    return mapPoseLandmark(lm, out);
  }

  updatePose(poseLandmarks) {
    if (!poseLandmarks || !this.ready) return;
    let visible = 0;
    this.visibleNow.clear();
    Object.entries(LM).forEach(([name, index]) => {
      const lm = poseLandmarks[index];
      const minVisibility = LEG_LANDMARKS.has(name) ? 0.32 : 0.4;
      if (!landmarkVisible(lm, minVisibility)) return;
      this.targets.get(name).copy(this.mapLandmark(lm));
      this.visibleNow.add(name);
      visible += 1;
    });
    if (visible >= 6) {
      if (!this.haveSmooth) {
        this.visibleNow.forEach((name) => {
          this.smooth.get(name).copy(this.targets.get(name));
        });
      }
      this.haveSmooth = true;
      this.latestTrackedAt = performance.now();
    }
  }

  updateFace(faceLandmarks, media = {}) {
    if (!this.ready) return;

    if (!faceLandmarks?.length) {
      if (performance.now() - this.latestFaceTrackedAt > 150) {
        this.faceRig = null;
        this.latestFaceTrackedAt = 0;
      }
      return;
    }

    const next = solveFaceRig(faceLandmarks, media);
    if (next) {
      this.faceRig = next;
      this.latestFaceTrackedAt = performance.now();
    } else if (performance.now() - this.latestFaceTrackedAt > 150) {
      this.faceRig = null;
      this.latestFaceTrackedAt = 0;
    }
  }

  updateHands(leftHandLandmarks, rightHandLandmarks) {
    if (!this.ready) return;
    this.ingestHand("left", leftHandLandmarks);
    this.ingestHand("right", rightHandLandmarks);
  }

  updateTracking({ poseLandmarks, faceLandmarks, leftHandLandmarks, rightHandLandmarks, media } = {}) {
    this.updatePose(poseLandmarks);
    this.updateFace(faceLandmarks, media);
    this.updateHands(leftHandLandmarks, rightHandLandmarks);
    this.refreshMeta();
  }

  ingestHand(side, landmarks) {
    const visible = this.handVisible[side];
    visible.clear();
    if (!landmarks?.length || !isHandTracked(landmarks)) {
      this.latestHandTrackedAt[side] = 0;
      return;
    }

    landmarks.forEach((landmark, index) => {
      if (!landmark) return;
      this.handTargets[side].get(index).copy(mapHandLandmark(landmark));
      visible.add(index);
    });

    this.latestHandTrackedAt[side] = performance.now();
  }

  smoothHands(delta) {
    ["left", "right"].forEach((side) => {
      if (performance.now() - this.latestHandTrackedAt[side] > 900) return;
      this.handVisible[side].forEach((index) => {
        const target = this.handTargets[side].get(index);
        const smooth = this.handSmooth[side].get(index);
        const filters = this.handFilters[side].get(index);
        smooth.set(
          filters.x.filter(target.x, delta),
          filters.y.filter(target.y, delta),
          filters.z.filter(target.z, delta)
        );
      });
    });
  }

  retargetHands() {
    const now = performance.now();
    const getHand = (side, index) => this.handSmooth[side].get(index);

    this.handBones.forEach(
      ({ side, bone, from, to, restLocalQuat, restWorldQuat, restWorldDir }) => {
        if (now - this.latestHandTrackedAt[side] > 900) {
          bone.quaternion.slerp(restLocalQuat, 0.18);
          return;
        }
        const seen = this.handVisible[side];
        if (!seen.has(from) || !seen.has(to)) {
          bone.quaternion.slerp(restLocalQuat, 0.18);
          return;
        }

        this._targetDir.subVectors(getHand(side, to), getHand(side, from));
        if (this._targetDir.lengthSq() < 1e-6) return;
        this._targetDir.normalize();
        this.aimBone({ bone, restLocalQuat, restWorldQuat, restWorldDir }, this._targetDir);
      }
    );
  }

  refreshMeta() {
    const bodyActive = performance.now() - this.latestTrackedAt <= 900;
    const faceActive = this.isFaceActive();
    const leftActive = performance.now() - this.latestHandTrackedAt.left <= 900;
    const rightActive = performance.now() - this.latestHandTrackedAt.right <= 900;
    if (!bodyActive && !faceActive && !leftActive && !rightActive) return;
    const parts = [];
    if (bodyActive) parts.push(`${this.visibleNow.size} body pts`);
    if (faceActive) parts.push("face rig");
    if (leftActive) parts.push("L hand");
    if (rightActive) parts.push("R hand");
    this.metaElement.textContent = `Tracking · ${parts.join(" · ")}`;
  }

  smoothPose(delta) {
    this.visibleNow.forEach((name) => {
      const target = this.targets.get(name);
      const smooth = this.smooth.get(name);
      const f = this.filters.get(name);
      if (!this.haveSmooth) {
        smooth.copy(target);
        return;
      }
      smooth.set(
        f.x.filter(target.x, delta),
        f.y.filter(target.y, delta),
        f.z.filter(target.z, delta)
      );
    });
  }

  isFaceActive() {
    return performance.now() - this.latestFaceTrackedAt <= 900 && Boolean(this.faceRig);
  }

  retargetHeadFromFace(blend = 0.35) {
    const { forward, up, headRoll } = this.faceRig;
    if (this.neckChainItem) {
      applyJointSwingTwist(this.neckChainItem, forward, up, blend);
    }
    if (this.head && this.headRest) {
      if (headRoll) {
        this._targetQuat.copy(this.headRest);
        this._delta.setFromAxisAngle(this._axisZ, headRoll);
        this._targetQuat.multiply(this._delta);
        this.head.quaternion.slerp(this._targetQuat, blend);
      } else {
        this.head.quaternion.slerp(this.headRest, blend);
      }
    }
  }

  aimBone({ bone, restLocalQuat, restWorldQuat, restWorldDir }, targetDir) {
    this._targetDir.copy(targetDir);
    if (this._targetDir.lengthSq() < 1e-6) return;
    this._targetDir.normalize();
    this._delta.setFromUnitVectors(restWorldDir, this._targetDir);
    this._desired.multiplyQuaternions(this._delta, restWorldQuat);
    bone.parent.getWorldQuaternion(this._parentQuat);
    this._parentQuat.invert();
    bone.quaternion.multiplyQuaternions(this._parentQuat, this._desired);
  }

  getBodyNeckDirection() {
    return writeNeckDirection(
      (name) => this.smooth.get(name),
      (name) => this.visibleNow.has(name),
      this._targetDir
    );
  }

  retargetTorsoFromSkeleton(get, has) {
    const core =
      has("leftShoulder") &&
      has("rightShoulder") &&
      has("leftHip") &&
      has("rightHip");

    if (!core) {
      if (this.hips && this.hipsRest) this.hips.quaternion.slerp(this.hipsRest, 0.2);
      if (this.spine && this.spineRest) this.spine.quaternion.slerp(this.spineRest, 0.2);
      return;
    }

    if (this.hips && this.hipsRest) {
      this.hips.quaternion.copy(this.hipsRest);
      this.hips.rotateY(-hipLineYaw(get, has));
    }

    if (this.spineRetarget && writeTorsoDirection(get, has, this._targetDir)) {
      this.aimBone(this.spineRetarget, this._targetDir);
    } else if (this.spine && this.spineRest) {
      this.spine.quaternion.copy(this.spineRest);
      this.spine.rotateY(-shoulderTwistYaw(get, has) * 0.92);
    }
  }

  retargetBody() {
    const get = (name) => this.smooth.get(name);
    const has = (name) => this.visibleNow.has(name);
    const side = (n) => (SWAP_LR ? opposite(n) : n);

    this.retargetTorsoFromSkeleton(get, has);
    if (this.model) this.model.updateMatrixWorld(true);

    this.bones.forEach((entry) => {
      const footSide =
        entry.limb === "foot" ? (entry.from.startsWith("left") ? "left" : "right") : null;
      if (
        !writeSegmentDirection(get, has, entry.from, entry.to, this._targetDir, {
          footSide,
          swap: side
        })
      ) {
        entry.bone.quaternion.slerp(entry.restLocalQuat, 0.2);
        return;
      }
      this.aimBone(entry, this._targetDir);
    });

    this.retargetHead();
    if (this.model) this.model.updateMatrixWorld(true);
  }

  retargetHead() {
    const blend = 0.35;

    if (this.neckRetarget) {
      const targetDir = this.getBodyNeckDirection();
      if (targetDir) {
        this.aimBone(this.neckRetarget, targetDir);
      }
    }

    if (this.isFaceActive() && this.neck && this.neckRest) {
      this.retargetHeadFromFace(blend);
      return;
    }

    if (this.head && this.headRest) {
      this.head.quaternion.slerp(this.headRest, 0.2);
    }
    if (this.neck && this.neckRest && !this.neckRetarget) {
      this.neck.quaternion.slerp(this.neckRest, 0.2);
    }
  }

  resetToRestPose() {
    this.bones.forEach(({ bone, restLocalQuat }) => {
      bone.quaternion.copy(restLocalQuat);
    });
    this.handBones.forEach(({ bone, restLocalQuat }) => {
      bone.quaternion.copy(restLocalQuat);
    });
    if (this.hips && this.hipsRest) this.hips.quaternion.copy(this.hipsRest);
    if (this.spine && this.spineRest) this.spine.quaternion.copy(this.spineRest);
    if (this.neck && this.neckRest) this.neck.quaternion.copy(this.neckRest);
    if (this.head && this.headRest) this.head.quaternion.copy(this.headRest);
    if (this.model) {
      this.model.position.set(0, 0, 0);
      this.model.rotation.set(0, 0, 0);
      this.model.updateMatrixWorld(true);
    }
  }

  animate() {
    if (this.stopped || this.paused) {
      this.rafId = null;
      return;
    }
    const now = performance.now();
    const delta = Math.min((now - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = now;

    const bodyTracking = this.ready && now - this.latestTrackedAt <= 900;
    const faceTracking = this.ready && this.isFaceActive();
    const handTracking =
      this.handBones.length > 0 &&
      (now - this.latestHandTrackedAt.left <= 900 ||
        now - this.latestHandTrackedAt.right <= 900);
    const liveTracking = bodyTracking || faceTracking || handTracking;

    if (liveTracking) {
      if (this.idleAction?.isRunning()) this.idleAction.stop();
      if (bodyTracking) {
        this.smoothPose(delta);
        this.retargetBody();
      } else if (faceTracking) {
        this.retargetHead();
      }
      if (handTracking) {
        this.smoothHands(delta);
        this.retargetHands();
      }
      if (this.model) this.model.updateMatrixWorld(true);
    } else if (this.mixer) {
      if (this.idleAction?.isRunning()) {
        this.mixer.update(delta);
      } else {
        this.resetToRestPose();
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(() => this.animate());
  }

  setPaused(paused) {
    if (this.stopped || this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      this.lastFrameAt = performance.now();
      if (!this.rafId) this.animate();
    }
  }

  resize() {
    const width = Math.max(this.mount.clientWidth, 120);
    const height = Math.max(this.mount.clientHeight, 120);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose() {
    this.stopped = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.clearModel();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.mount) {
      this.mount.removeChild(this.renderer.domElement);
    }
  }
}
