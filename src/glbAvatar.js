import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OneEuro } from "./avatar.js";

// MediaPipe pose landmark indices we use for retargeting.
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

// Each driven bone aims along the vector between two MediaPipe landmarks.
// childBone is used at load time to read the bone's rest "down-the-bone" axis.
const BONE_MAP = [
  { bone: "mixamorigLeftArm", child: "mixamorigLeftForeArm", from: "leftShoulder", to: "leftElbow" },
  { bone: "mixamorigLeftForeArm", child: "mixamorigLeftHand", from: "leftElbow", to: "leftWrist" },
  { bone: "mixamorigRightArm", child: "mixamorigRightForeArm", from: "rightShoulder", to: "rightElbow" },
  { bone: "mixamorigRightForeArm", child: "mixamorigRightHand", from: "rightElbow", to: "rightWrist" },
  { bone: "mixamorigLeftUpLeg", child: "mixamorigLeftLeg", from: "leftHip", to: "leftKnee" },
  { bone: "mixamorigLeftLeg", child: "mixamorigLeftFoot", from: "leftKnee", to: "leftAnkle" },
  { bone: "mixamorigRightUpLeg", child: "mixamorigRightLeg", from: "rightHip", to: "rightKnee" },
  { bone: "mixamorigRightLeg", child: "mixamorigRightFoot", from: "rightKnee", to: "rightAnkle" }
];

// Orientation calibration. sx/sy/sz are axis sign+scale for mapLandmark;
// swapLR drives each bone from the opposite-side landmarks (for a true mirror).
const CAL = { sx: -1, sy: -1, sz: -0.4, swapLR: false };

const OPPOSITE = (name) =>
  name.startsWith("left") ? name.replace("left", "right") : name.replace("right", "left");

const CHARACTER_URL = "/models/character.glb";

function landmarkVisible(landmark) {
  return Boolean(landmark && (landmark.visibility ?? 1) > 0.4);
}

export class CharacterAvatar {
  constructor(mount, metaElement) {
    this.mount = mount;
    this.metaElement = metaElement;
    this.startedAt = performance.now();
    this.lastFrameAt = this.startedAt;
    this.latestTrackedAt = 0;
    this.stopped = false;
    this.ready = false;
    this.cal = { ...CAL };

    // Smoothed, mapped world positions for each landmark we track.
    this.smooth = new Map();
    this.filters = new Map();
    Object.keys(LM).forEach((name) => {
      this.smooth.set(name, new THREE.Vector3());
      this.filters.set(name, {
        x: new OneEuro(),
        y: new OneEuro(),
        z: new OneEuro({ minCutoff: 0.7, beta: 0.006 })
      });
    });
    this.haveSmooth = false;

    // Reusable temporaries to avoid per-frame allocation.
    this._restDir = new THREE.Vector3();
    this._targetDir = new THREE.Vector3();
    this._delta = new THREE.Quaternion();
    this._parentQuat = new THREE.Quaternion();
    this._desired = new THREE.Quaternion();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06080e);

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    this.camera.position.set(0, 1.4, 4.2);
    this.camera.lookAt(0, 1.1, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mount.appendChild(this.renderer.domElement);

    this.createLights();
    this.createWorld();
    this.loadCharacter();
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

  loadCharacter() {
    this.metaElement.textContent = "Loading character model...";
    new GLTFLoader().load(
      CHARACTER_URL,
      (gltf) => {
        this.model = gltf.scene;
        this.scene.add(this.model);

        // Find bones by name and capture rest pose data for retargeting.
        this.bones = [];
        this.model.updateMatrixWorld(true);
        BONE_MAP.forEach((entry) => {
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

        // Idle animation plays when nobody is being tracked.
        this.mixer = new THREE.AnimationMixer(this.model);
        const idle = THREE.AnimationClip.findByName(gltf.animations, "idle");
        if (idle) {
          this.idleAction = this.mixer.clipAction(idle);
          this.idleAction.play();
        }

        this.ready = true;
        this.metaElement.textContent = "Character ready - stand in frame";
      },
      undefined,
      (err) => {
        console.error("Character load failed:", err);
        this.metaElement.textContent = "Character failed to load";
      }
    );
  }

  // MediaPipe normalized coords -> avatar world space, via CAL signs.
  mapLandmark(lm) {
    const c = this.cal;
    return new THREE.Vector3(
      c.sx * (lm.x - 0.5) * 2.0,
      c.sy * (lm.y - 0.5) * 2.0,
      c.sz * (lm.z || 0)
    );
  }

  updatePose(poseLandmarks) {
    if (!poseLandmarks) return;
    let visible = 0;
    const dt = 1 / 30;
    this.visibleNow = this.visibleNow || new Set();
    this.visibleNow.clear();
    Object.entries(LM).forEach(([name, index]) => {
      const lm = poseLandmarks[index];
      if (!landmarkVisible(lm)) return;
      const mapped = this.mapLandmark(lm);
      const f = this.filters.get(name);
      const target = this.smooth.get(name);
      if (this.haveSmooth) {
        target.set(f.x.filter(mapped.x, dt), f.y.filter(mapped.y, dt), f.z.filter(mapped.z, dt));
      } else {
        target.copy(mapped);
      }
      this.visibleNow.add(name);
      visible += 1;
    });
    if (visible >= 6) {
      this.haveSmooth = true;
      this.latestTrackedAt = performance.now();
      this.metaElement.textContent = `Character tracking ${visible} body points`;
    }
  }

  retarget() {
    const get = (name) => this.smooth.get(name);

    const seen = this.visibleNow || new Set();
    const side = (n) => (this.cal.swapLR ? OPPOSITE(n) : n);

    this.bones.forEach(({ bone, from, to, restLocalQuat, restWorldQuat, restWorldDir }) => {
      const f = side(from);
      const t = side(to);
      // Only drive a bone when both its landmarks are visible this frame;
      // otherwise ease it back to rest so off-screen limbs don't flail.
      if (!seen.has(f) || !seen.has(t)) {
        bone.quaternion.slerp(restLocalQuat, 0.2);
        bone.updateWorldMatrix(false, false);
        return;
      }

      this._targetDir.subVectors(get(t), get(f));
      // MediaPipe depth is noisy; flatten it so limbs stay in the frontal plane.
      this._targetDir.z *= 0.25;
      if (this._targetDir.lengthSq() < 1e-6) return;
      this._targetDir.normalize();

      // Rotate the bone's rest orientation so its child-direction points at the target.
      this._delta.setFromUnitVectors(restWorldDir, this._targetDir);
      this._desired.multiplyQuaternions(this._delta, restWorldQuat);

      // Convert that desired world orientation into the bone's local space.
      bone.parent.getWorldQuaternion(this._parentQuat);
      this._parentQuat.invert();
      bone.quaternion.multiplyQuaternions(this._parentQuat, this._desired);
      bone.updateWorldMatrix(false, false);
    });

    // Torso lean: spine follows the hips -> shoulders line.
    if (this.spine && this.spineRest) {
      const hipMid = get("leftHip").clone().add(get("rightHip")).multiplyScalar(0.5);
      const shMid = get("leftShoulder").clone().add(get("rightShoulder")).multiplyScalar(0.5);
      const up = shMid.sub(hipMid).normalize();
      const lean = Math.atan2(up.x, up.y); // side-to-side lean
      this.spine.quaternion.copy(this.spineRest);
      this.spine.rotateZ(THREE.MathUtils.clamp(-lean, -0.5, 0.5));
    }

    // Head: nod/turn from the nose relative to the shoulders.
    if (this.neck && this.neckRest) {
      const shMid = get("leftShoulder").clone().add(get("rightShoulder")).multiplyScalar(0.5);
      const dir = get("nose").clone().sub(shMid);
      this.neck.quaternion.copy(this.neckRest);
      this.neck.rotateY(THREE.MathUtils.clamp(dir.x * 1.2, -0.6, 0.6));
      this.neck.rotateX(THREE.MathUtils.clamp(-(dir.y - 0.25) * 1.0, -0.5, 0.5));
    }
  }

  animate() {
    if (this.stopped) return;
    const now = performance.now();
    const delta = Math.min((now - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = now;

    const tracking = this.ready && now - this.latestTrackedAt <= 900;

    if (tracking) {
      // Manual retargeting wins; pause idle so it doesn't fight the pose.
      this.retarget();
    } else if (this.mixer) {
      this.mixer.update(delta);
      if (this.ready && performance.now() - this.startedAt > 1500 && this.haveSmooth) {
        this.metaElement.textContent = "Character idle - waiting for your pose";
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(() => this.animate());
  }

  resize() {
    const width = Math.max(this.mount.clientWidth, 320);
    const height = Math.max(this.mount.clientHeight, 260);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height, false);
  }

  dispose() {
    this.stopped = true;
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.mount) {
      this.mount.removeChild(this.renderer.domElement);
    }
  }
}
