import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OneEuro } from "./avatar.js";

const LM = {
  nose: 0,
  leftShoulder: 11,
  rightShoulder: 12,
  leftElbow: 13,
  rightElbow: 14,
  leftWrist: 15,
  rightWrist: 16,
  leftHip: 23,
  rightHip: 24,
  leftKnee: 25,
  rightKnee: 26,
  leftAnkle: 27,
  rightAnkle: 28
};

export const MIXAMO_BONE_MAP = [
  { bone: "mixamorigLeftArm", child: "mixamorigLeftForeArm", from: "leftShoulder", to: "leftElbow" },
  { bone: "mixamorigLeftForeArm", child: "mixamorigLeftHand", from: "leftElbow", to: "leftWrist" },
  { bone: "mixamorigRightArm", child: "mixamorigRightForeArm", from: "rightShoulder", to: "rightElbow" },
  { bone: "mixamorigRightForeArm", child: "mixamorigRightHand", from: "rightElbow", to: "rightWrist" },
  { bone: "mixamorigLeftUpLeg", child: "mixamorigLeftLeg", from: "leftHip", to: "leftKnee" },
  { bone: "mixamorigLeftLeg", child: "mixamorigLeftFoot", from: "leftKnee", to: "leftAnkle" },
  { bone: "mixamorigRightUpLeg", child: "mixamorigRightLeg", from: "rightHip", to: "rightKnee" },
  { bone: "mixamorigRightLeg", child: "mixamorigRightFoot", from: "rightKnee", to: "rightAnkle" }
];

const CAL = { sx: 1, sy: -1, sz: -0.4, swapLR: false };

const OPPOSITE = (name) =>
  name.startsWith("left") ? name.replace("left", "right") : name.replace("right", "left");

function landmarkVisible(landmark) {
  return Boolean(landmark && (landmark.visibility ?? 1) > 0.4);
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
    this.stopped = false;
    this.paused = false;
    this.ready = false;
    this.loading = false;
    this.cal = { ...CAL };
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
        x: new OneEuro({ minCutoff: 2.4, beta: 0.028 }),
        y: new OneEuro({ minCutoff: 2.4, beta: 0.028 }),
        z: new OneEuro({ minCutoff: 1.6, beta: 0.012 })
      });
    });
    this.haveSmooth = false;

    this._mapped = new THREE.Vector3();
    this._hipMid = new THREE.Vector3();
    this._shMid = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._headDir = new THREE.Vector3();
    this._targetDir = new THREE.Vector3();
    this._delta = new THREE.Quaternion();
    this._parentQuat = new THREE.Quaternion();
    this._desired = new THREE.Quaternion();

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
    this.clips = [];
    this.spine = null;
    this.spineRest = null;
    this.neck = null;
    this.neckRest = null;
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
        this.scene.add(this.model);
        this.clips = gltf.animations;
        this.animationNames = gltf.animations.map((clip) => clip.name);

        this.bones = [];
        this.model.updateMatrixWorld(true);
        this.boneMap.forEach((entry) => {
          const bone = this.model.getObjectByName(entry.bone);
          const child = this.model.getObjectByName(entry.child);
          if (!bone || !child) return;
          const boneWorld = new THREE.Vector3();
          const childWorld = new THREE.Vector3();
          bone.getWorldPosition(boneWorld);
          child.getWorldPosition(childWorld);
          this.bones.push({
            bone,
            from: entry.from,
            to: entry.to,
            restLocalQuat: bone.quaternion.clone(),
            restWorldQuat: bone.getWorldQuaternion(new THREE.Quaternion()),
            restWorldDir: childWorld.sub(boneWorld).normalize()
          });
        });

        this.spine = this.model.getObjectByName("mixamorigSpine");
        this.spineRest = this.spine ? this.spine.quaternion.clone() : null;
        this.neck = this.model.getObjectByName("mixamorigNeck");
        this.neckRest = this.neck ? this.neck.quaternion.clone() : null;

        this.mixer = new THREE.AnimationMixer(this.model);
        const defaultClip = this.pickDefaultClip();
        if (defaultClip) this.setAnimation(defaultClip);

        this.ready = this.bones.length > 0;
        this.metaElement.textContent = this.ready
          ? `${this.bones.length} bones · ${this.animationNames.length} clips`
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

  mapLandmark(lm, out = this._mapped) {
    const c = this.cal;
    return out.set(
      c.sx * (lm.x - 0.5) * 2.0,
      c.sy * (lm.y - 0.5) * 2.0,
      c.sz * (lm.z || 0)
    );
  }

  updatePose(poseLandmarks) {
    if (!poseLandmarks || !this.ready) return;
    let visible = 0;
    this.visibleNow = this.visibleNow || new Set();
    this.visibleNow.clear();
    Object.entries(LM).forEach(([name, index]) => {
      const lm = poseLandmarks[index];
      if (!landmarkVisible(lm)) return;
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
      this.metaElement.textContent = `Tracking ${visible} pts`;
    }
  }

  smoothPose(delta) {
    const seen = this.visibleNow || new Set();
    seen.forEach((name) => {
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
    if (seen.size >= 6) this.haveSmooth = true;
  }

  retarget() {
    const get = (name) => this.smooth.get(name);
    const seen = this.visibleNow || new Set();
    const side = (n) => (this.cal.swapLR ? OPPOSITE(n) : n);

    this.bones.forEach(({ bone, from, to, restLocalQuat, restWorldQuat, restWorldDir }) => {
      const f = side(from);
      const t = side(to);
      if (!seen.has(f) || !seen.has(t)) {
        bone.quaternion.slerp(restLocalQuat, 0.2);
        return;
      }

      this._targetDir.subVectors(get(t), get(f));
      this._targetDir.z *= 0.25;
      if (this._targetDir.lengthSq() < 1e-6) return;
      this._targetDir.normalize();

      this._delta.setFromUnitVectors(restWorldDir, this._targetDir);
      this._desired.multiplyQuaternions(this._delta, restWorldQuat);
      bone.parent.getWorldQuaternion(this._parentQuat);
      this._parentQuat.invert();
      bone.quaternion.multiplyQuaternions(this._parentQuat, this._desired);
    });

    if (this.model) this.model.updateMatrixWorld(true);

    if (this.spine && this.spineRest) {
      this._hipMid.addVectors(get("leftHip"), get("rightHip")).multiplyScalar(0.5);
      this._shMid.addVectors(get("leftShoulder"), get("rightShoulder")).multiplyScalar(0.5);
      this._up.subVectors(this._shMid, this._hipMid).normalize();
      const lean = Math.atan2(this._up.x, this._up.y);
      this.spine.quaternion.copy(this.spineRest);
      this.spine.rotateZ(THREE.MathUtils.clamp(-lean, -0.5, 0.5));
    }

    if (this.neck && this.neckRest) {
      this._shMid.addVectors(get("leftShoulder"), get("rightShoulder")).multiplyScalar(0.5);
      this._headDir.subVectors(get("nose"), this._shMid);
      this.neck.quaternion.copy(this.neckRest);
      this.neck.rotateY(THREE.MathUtils.clamp(this._headDir.x * 1.2, -0.6, 0.6));
      this.neck.rotateX(THREE.MathUtils.clamp(-(this._headDir.y - 0.25) * 1.0, -0.5, 0.5));
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

    const tracking = this.ready && now - this.latestTrackedAt <= 900;

    if (tracking) {
      if (this.idleAction?.isRunning()) this.idleAction.stop();
      this.smoothPose(delta);
      this.retarget();
    } else if (this.mixer) {
      if (this.idleAction && !this.idleAction.isRunning()) this.idleAction.play();
      this.mixer.update(delta);
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
