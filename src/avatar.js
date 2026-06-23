import * as THREE from "three";
import { HAND_CONNECTIONS, resolveFingerSegment } from "./handRig.js";
import { FACE_HEAD_KEYS, FACE_HEAD_LANDMARKS, solveFaceRig } from "./faceRig.js";
import { mapHandLandmark as mapHandPoint, mapPoseLandmark, POSE_LM } from "./poseSkeleton.js";

const BODY_POINTS = POSE_LM;

const BONES = [
  ["leftShoulder", "rightShoulder", "collar"],
  ["leftHip", "rightHip", "hip"],
  ["leftShoulder", "leftElbow", "arm"],
  ["leftElbow", "leftWrist", "arm"],
  ["rightShoulder", "rightElbow", "arm"],
  ["rightElbow", "rightWrist", "arm"],
  ["leftHip", "leftKnee", "leg"],
  ["leftKnee", "leftAnkle", "leg"],
  ["leftAnkle", "leftHeel", "leg"],
  ["leftHeel", "leftFootIndex", "leg"],
  ["rightHip", "rightKnee", "leg"],
  ["rightKnee", "rightAnkle", "leg"],
  ["rightAnkle", "rightHeel", "leg"],
  ["rightHeel", "rightFootIndex", "leg"],
  ["leftShoulder", "leftHip", "side"],
  ["rightShoulder", "rightHip", "side"]
];

const BONE_STYLE = {
  collar: { radius: 0.055, color: 0x7df8ce },
  hip: { radius: 0.06, color: 0x75a7ff },
  arm: { radius: 0.045, color: 0xff7bd5 },
  leg: { radius: 0.052, color: 0x75a7ff },
  side: { radius: 0.04, color: 0x37e9a8 }
};

function landmarkVisible(landmark) {
  return Boolean(landmark && (landmark.visibility ?? 1) > 0.36);
}

// One-Euro filter: low jitter when still, low lag when moving fast.
// Smooths a single scalar; we run one per axis of each tracked landmark.
export class OneEuro {
  constructor({ minCutoff = 1.4, beta = 0.012, dCutoff = 1.0 } = {}) {
    this.minCutoff = minCutoff;
    this.beta = beta;
    this.dCutoff = dCutoff;
    this.x = null;
    this.dx = 0;
  }

  static alpha(cutoff, dt) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  filter(value, dt) {
    if (this.x === null) {
      this.x = value;
      return value;
    }
    const dt_ = dt > 0 ? dt : 1 / 60;
    const dValue = (value - this.x) / dt_;
    const aD = OneEuro.alpha(this.dCutoff, dt_);
    this.dx = aD * dValue + (1 - aD) * this.dx;
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = OneEuro.alpha(cutoff, dt_);
    this.x = a * value + (1 - a) * this.x;
    return this.x;
  }
}

function midpoint(a, b) {
  return new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
}

function makeMaterial(color, roughness = 0.52) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness,
    metalness: 0.08,
    emissive: color,
    emissiveIntensity: 0.06
  });
}

function setCylinderBetween(mesh, start, end) {
  const delta = new THREE.Vector3().subVectors(end, start);
  const length = Math.max(delta.length(), 0.001);
  mesh.position.copy(midpoint(start, end));
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
}

function containRect(sourceWidth, sourceHeight, targetWidth, targetHeight) {
  if (!sourceWidth || !sourceHeight || !targetWidth || !targetHeight) {
    return { x: 0, y: 0, width: targetWidth, height: targetHeight };
  }

  const scale = Math.min(targetWidth / sourceWidth, targetHeight / sourceHeight);
  const width = sourceWidth * scale;
  const height = sourceHeight * scale;

  return {
    x: (targetWidth - width) / 2,
    y: (targetHeight - height) / 2,
    width,
    height
  };
}

export class MushyAvatar {
  constructor(mount, metaElement, options = {}) {
    this.mount = mount;
    this.metaElement = metaElement;
    this.framedViewport = Boolean(options.framedViewport ?? mount?.id === "riggedModelMount");
    this._viewport = { x: 0, y: 0, width: 0, height: 0 };
    this.startedAt = performance.now();
    this.lastFrameAt = this.startedAt;
    this.points = new Map();
    this.targetPoints = new Map();
    this.filters = new Map();
    this.joints = new Map();
    this.bones = [];
    this.activePoints = new Set();
    this.latestTrackedAt = 0;
    this.latestFaceTrackedAt = 0;
    this.faceRig = null;
    this.latestHandTrackedAt = { left: 0, right: 0 };
    this.faceTargets = new Map();
    this.facePoints = new Map();
    this.faceFilters = new Map();
    this.faceVisible = new Set();
    FACE_HEAD_KEYS.forEach((name) => {
      this.faceTargets.set(name, new THREE.Vector3());
      this.facePoints.set(name, new THREE.Vector3());
      this.faceFilters.set(name, {
        x: new OneEuro({ minCutoff: 2.2, beta: 0.024 }),
        y: new OneEuro({ minCutoff: 2.2, beta: 0.024 }),
        z: new OneEuro({ minCutoff: 1.2, beta: 0.01 })
      });
    });
    this._headEuler = new THREE.Euler();
    this._headTargetQuat = new THREE.Quaternion();
    this._headLookMatrix = new THREE.Matrix4();
    this.paused = false;
    this._mapScratch = new THREE.Vector3();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06080e);

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    this.frameBodyCamera();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mount.appendChild(this.renderer.domElement);

    this.root = new THREE.Group();
    this.root.position.y = -0.15;
    this.scene.add(this.root);

    this.createLights();
    this.createWorld();
    this.createRig();
    this.hands = {
      left: this.buildHandRig(0xff7bd5),
      right: this.buildHandRig(0x59a6ff)
    };
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    this.animate();
  }

  createLights() {
    this.scene.add(new THREE.HemisphereLight(0x9eefff, 0x101624, 1.85));

    const key = new THREE.DirectionalLight(0xffffff, 2.4);
    key.position.set(3, 5, 4);
    this.scene.add(key);

    const rim = new THREE.PointLight(0x00f0a8, 6.5, 10);
    rim.position.set(-2.4, 1.8, 3);
    this.scene.add(rim);
  }

  createWorld() {
    const grid = new THREE.GridHelper(6.4, 16, 0x214053, 0x182431);
    grid.position.y = -2.12;
    grid.material.transparent = true;
    grid.material.opacity = 0.48;
    this.scene.add(grid);

    const haloGeometry = new THREE.TorusGeometry(1.7, 0.012, 10, 96);
    const haloMaterial = new THREE.MeshBasicMaterial({ color: 0x00f0a8, transparent: true, opacity: 0.28 });
    const halo = new THREE.Mesh(haloGeometry, haloMaterial);
    halo.position.set(0, -0.15, -0.8);
    halo.rotation.x = Math.PI / 2;
    this.scene.add(halo);
  }

  createRig() {
    const jointGeometry = new THREE.SphereGeometry(0.078, 20, 20);
    const jointMaterial = makeMaterial(0xf5fffb, 0.35);

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
        z: new OneEuro({ minCutoff: 0.7, beta: 0.006 }) // depth is noisier, smooth harder
      });
    });

    // End-caps so wrists read as hands and ankles as feet.
    const handGeometry = new THREE.SphereGeometry(0.12, 18, 18);
    const footGeometry = new THREE.SphereGeometry(0.13, 18, 18);
    const handMaterial = makeMaterial(0xff7bd5, 0.4);
    const footMaterial = makeMaterial(0x75a7ff, 0.4);
    this.caps = {
      leftWrist: new THREE.Mesh(handGeometry, handMaterial),
      rightWrist: new THREE.Mesh(handGeometry, handMaterial),
      leftAnkle: new THREE.Mesh(footGeometry, footMaterial),
      rightAnkle: new THREE.Mesh(footGeometry, footMaterial)
    };
    Object.values(this.caps).forEach((cap) => {
      cap.visible = false;
      this.root.add(cap);
    });

    // Neck connects the torso/shoulders to the head.
    const neckStyle = BONE_STYLE.collar;
    this.neck = new THREE.Mesh(
      new THREE.CylinderGeometry(neckStyle.radius * 0.7, neckStyle.radius * 0.9, 1, 16),
      makeMaterial(0xd7fff2, 0.5)
    );
    this.neck.visible = false;
    this.root.add(this.neck);

    BONES.forEach(([from, to, variant]) => {
      const style = BONE_STYLE[variant];
      const geometry = new THREE.CylinderGeometry(style.radius, style.radius, 1, 18);
      const material = makeMaterial(style.color, 0.44);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.root.add(mesh);
      this.bones.push({ from, to, mesh });
    });

    this.torso = new THREE.Mesh(
      new THREE.SphereGeometry(0.82, 32, 32),
      new THREE.MeshStandardMaterial({
        color: 0x1ae7a0,
        roughness: 0.6,
        metalness: 0.04,
        transparent: true,
        opacity: 0.32,
        emissive: 0x0ad184,
        emissiveIntensity: 0.08
      })
    );
    this.torso.scale.set(0.85, 1.15, 0.36);
    this.root.add(this.torso);

    this.head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 32, 32),
      makeMaterial(0xd7fff2, 0.5)
    );
    this.root.add(this.head);

    const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x061018 });
    this.leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), eyeMaterial);
    this.rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 12), eyeMaterial);
    this.head.add(this.leftEye, this.rightEye);
    this.leftEye.position.set(-0.105, 0.06, 0.29);
    this.rightEye.position.set(0.105, 0.06, 0.29);

    const antennaMaterial = new THREE.MeshBasicMaterial({ color: 0x00f0a8 });
    this.antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.45, 10), antennaMaterial);
    this.antenna.position.set(0, 0.33, 0);
    this.head.add(this.antenna);
  }

  buildHandRig(color) {
    const points = new Map();
    const targets = new Map();
    const filters = new Map();
    const segments = [];

    for (let index = 0; index < 21; index += 1) {
      points.set(index, new THREE.Vector3());
      targets.set(index, new THREE.Vector3());
      filters.set(index, {
        x: new OneEuro({ minCutoff: 1.8, beta: 0.018 }),
        y: new OneEuro({ minCutoff: 1.8, beta: 0.018 }),
        z: new OneEuro({ minCutoff: 1.0, beta: 0.008 })
      });
    }

    const material = makeMaterial(color, 0.46);
    HAND_CONNECTIONS.forEach(([from, to]) => {
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 8), material);
      mesh.visible = false;
      this.root.add(mesh);
      segments.push({ from, to, mesh });
    });

    const tipGeometry = new THREE.SphereGeometry(0.022, 10, 10);
    const tips = new Map();
    [4, 8, 12, 16, 20].forEach((index) => {
      const tip = new THREE.Mesh(tipGeometry, material);
      tip.visible = false;
      this.root.add(tip);
      tips.set(index, tip);
    });

    return { points, targets, filters, segments, tips, active: false };
  }

  mapLandmark(landmark, out = this._mapScratch) {
    return mapPoseLandmark(landmark, out);
  }

  mapHandLandmark(landmark, out = this._mapScratch) {
    return mapHandPoint(landmark, out);
  }

  isHandSideActive(side) {
    return performance.now() - this.latestHandTrackedAt[side] <= 900;
  }

  isFaceActive() {
    return performance.now() - this.latestFaceTrackedAt <= 900 && Boolean(this.faceRig);
  }

  isAnyHandActive() {
    return this.isHandSideActive("left") || this.isHandSideActive("right");
  }

  refreshMeta() {
    const bodyActive = performance.now() - this.latestTrackedAt <= 900;
    const faceActive = this.isFaceActive();
    const leftActive = this.isHandSideActive("left");
    const rightActive = this.isHandSideActive("right");
    if (!bodyActive && !faceActive && !leftActive && !rightActive) return;

    const parts = [];
    if (bodyActive) parts.push(`${this.activePoints.size} body pts`);
    if (faceActive) parts.push("face rig");
    if (leftActive) parts.push("L hand");
    if (rightActive) parts.push("R hand");
    this.metaElement.textContent = `Mushy tracking · ${parts.join(" · ")}`;
  }

  updateFace(faceLandmarks, media = {}) {
    this.faceVisible.clear();

    if (!faceLandmarks?.length) {
      if (performance.now() - this.latestFaceTrackedAt > 150) {
        this.faceRig = null;
        this.latestFaceTrackedAt = 0;
      }
      return;
    }

    FACE_HEAD_KEYS.forEach((name) => {
      const landmark = faceLandmarks[FACE_HEAD_LANDMARKS[name]];
      if (!landmark) return;
      this.faceTargets.get(name).copy(this.mapLandmark(landmark));
      this.faceVisible.add(name);
    });

    const next = solveFaceRig(faceLandmarks, media);
    if (next) {
      this.faceRig = next;
      this.latestFaceTrackedAt = performance.now();
    } else if (performance.now() - this.latestFaceTrackedAt > 150) {
      this.faceRig = null;
      this.latestFaceTrackedAt = 0;
    }
  }

  updatePose(poseLandmarks) {
    if (!poseLandmarks) return;

    let visibleCount = 0;
    const nextActivePoints = new Set();
    Object.entries(BODY_POINTS).forEach(([name, index]) => {
      const landmark = poseLandmarks[index];
      if (!landmarkVisible(landmark)) return;
      this.targetPoints.get(name).copy(this.mapLandmark(landmark));
      nextActivePoints.add(name);
      visibleCount += 1;
    });

    if (visibleCount >= 5) {
      this.activePoints = nextActivePoints;
      this.latestTrackedAt = performance.now();
    }
  }

  updateHands(leftHandLandmarks, rightHandLandmarks) {
    this.updateHandSide("left", leftHandLandmarks);
    this.updateHandSide("right", rightHandLandmarks);
  }

  updateTracking({ poseLandmarks, faceLandmarks, leftHandLandmarks, rightHandLandmarks, media } = {}) {
    this.updatePose(poseLandmarks);
    this.updateFace(faceLandmarks, media);
    this.updateHands(leftHandLandmarks, rightHandLandmarks);
    this.refreshMeta();
  }

  updateHandSide(side, landmarks) {
    const rig = this.hands[side];
    if (!rig || !landmarks?.length) {
      if (rig) rig.active = false;
      return;
    }

    let visible = 0;
    landmarks.forEach((landmark, index) => {
      if (!landmark) return;
      rig.targets.get(index).copy(this.mapHandLandmark(landmark));
      visible += 1;
    });

    if (visible >= 10) {
      rig.active = true;
      this.latestHandTrackedAt[side] = performance.now();
      const wristKey = side === "left" ? "leftWrist" : "rightWrist";
      if (landmarks[0]) {
        this.targetPoints.get(wristKey).copy(this.mapHandLandmark(landmarks[0]));
        this.activePoints.add(wristKey);
        this.latestTrackedAt = performance.now();
      }
    } else {
      rig.active = false;
      this.latestHandTrackedAt[side] = 0;
    }
  }

  smoothFacePoints(delta) {
    if (!this.isFaceActive()) return;
    this.faceVisible.forEach((name) => {
      const target = this.faceTargets.get(name);
      const point = this.facePoints.get(name);
      const filter = this.faceFilters.get(name);
      point.set(
        filter.x.filter(target.x, delta),
        filter.y.filter(target.y, delta),
        filter.z.filter(target.z, delta)
      );
    });
  }

  applyFaceHead(delta) {
    if (!this.faceRig?.forward || !this.faceRig?.up) return;

    const nose = this.facePoints.get("noseTip");
    if (nose) {
      this._mapScratch.set(
        THREE.MathUtils.clamp(nose.x, -1.4, 1.4),
        THREE.MathUtils.clamp(nose.y, 0.35, 1.85),
        THREE.MathUtils.clamp(nose.z, -1.15, -0.45)
      );
      this.head.position.lerp(this._mapScratch, Math.min(delta * 10, 1));
    }

    this._headLookMatrix.lookAt(
      new THREE.Vector3(0, 0, 0),
      this.faceRig.forward,
      this.faceRig.up
    );
    this._headTargetQuat.setFromRotationMatrix(this._headLookMatrix);
    this.head.quaternion.slerp(this._headTargetQuat, 0.35);

    const leftEye = this.facePoints.get("leftEyeOuter");
    const rightEye = this.facePoints.get("rightEyeOuter");
    if (leftEye && rightEye) {
      const neckAnchor = midpoint(leftEye, rightEye);
      this.neck.visible = true;
      setCylinderBetween(this.neck, neckAnchor, this.head.position);
    }
    this.head.scale.setScalar(0.92);
  }

  animateIdle(delta) {
    const now = performance.now();
    const bodyTracking = now - this.latestTrackedAt <= 900;
    const faceTracking = this.isFaceActive();
    const handTracking = this.isAnyHandActive();
    const t = (now - this.startedAt) / 1000;

    if (!bodyTracking && !faceTracking && !handTracking) {
      this.activePoints.clear();
      this.metaElement.textContent = "Mushy waiting for your body pose";
      this.bones.forEach(({ mesh }) => {
        mesh.visible = false;
      });
      this.joints.forEach((joint) => {
        joint.visible = false;
      });
      Object.values(this.caps).forEach((cap) => {
        cap.visible = false;
      });
      this.hideHandRigs();
      this.neck.visible = false;
      this.torso.position.lerp(new THREE.Vector3(0, -0.25, -0.65), Math.min(delta * 5, 1));
      this.head.position.lerp(new THREE.Vector3(0, 1.05, -0.65), Math.min(delta * 5, 1));
      this.head.quaternion.slerp(new THREE.Quaternion(), Math.min(delta * 5, 1));
      this.root.rotation.y = Math.sin(t * 0.45) * 0.12;
      this.root.position.y = -0.15 + Math.sin(t * 1.4) * 0.035;
      this.antenna.rotation.z = Math.sin(t * 2.6) * 0.18;
      return;
    }

    if (!bodyTracking && handTracking) {
      this.root.rotation.y = 0;
      this.root.position.y = -0.15;
      return;
    }

    if (!bodyTracking && faceTracking && !handTracking) {
      this.root.rotation.y = 0;
      this.root.position.y = -0.15;
      this.torso.position.lerp(new THREE.Vector3(0, -0.25, -0.65), Math.min(delta * 5, 1));
      this.torso.visible = true;
      this.torso.scale.set(0.72, 0.95, 0.3);
      return;
    }

    this.root.rotation.y = Math.sin(t * 0.45) * 0.12;
    this.root.position.y = -0.15 + Math.sin(t * 1.4) * 0.035;
    this.antenna.rotation.z = Math.sin(t * 2.6) * 0.18;
  }

  updateRig(delta) {
    this.points.forEach((point, name) => {
      const target = this.targetPoints.get(name);
      const filter = this.filters.get(name);
      point.set(
        filter.x.filter(target.x, delta),
        filter.y.filter(target.y, delta),
        filter.z.filter(target.z, delta)
      );
      const joint = this.joints.get(name);
      joint.position.copy(point);
    });

    this.smoothFacePoints(delta);

    const bodyTracking = performance.now() - this.latestTrackedAt <= 900;
    const faceTracking = this.isFaceActive();

    if (faceTracking && (!bodyTracking || !this.activePoints.has("nose"))) {
      this.applyFaceHead(delta);
    }

    if (bodyTracking) {
      this.root.rotation.y = 0;
      this.root.position.y = -0.15;

      this.joints.forEach((joint, name) => {
        joint.visible = this.activePoints.has(name);
      });

      this.bones.forEach(({ from, to, mesh }) => {
        const start = this.points.get(from);
        const end = this.points.get(to);
        mesh.visible =
          this.activePoints.has(from) && this.activePoints.has(to) && start.distanceTo(end) > 0.05;
        setCylinderBetween(mesh, start, end);
      });

      Object.entries(this.caps).forEach(([name, cap]) => {
        cap.visible = this.activePoints.has(name);
        if (cap.visible) cap.position.copy(this.points.get(name));
      });

      const hasCore = ["leftShoulder", "rightShoulder", "leftHip", "rightHip"].every((name) =>
        this.activePoints.has(name)
      );

      if (hasCore) {
        const leftShoulder = this.points.get("leftShoulder");
        const rightShoulder = this.points.get("rightShoulder");
        const leftHip = this.points.get("leftHip");
        const rightHip = this.points.get("rightHip");
        const shoulderMid = midpoint(leftShoulder, rightShoulder);
        const hipMid = midpoint(leftHip, rightHip);
        const torsoMid = midpoint(shoulderMid, hipMid);
        const torsoHeight = Math.max(shoulderMid.distanceTo(hipMid), 0.6);
        const shoulderWidth = Math.max(leftShoulder.distanceTo(rightShoulder), 0.55);

        this.torso.position.copy(torsoMid);
        this.torso.scale.set(shoulderWidth * 0.62, torsoHeight * 0.82, 0.34);
        this.torso.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          new THREE.Vector3().subVectors(shoulderMid, hipMid).normalize()
        );

        if (faceTracking) {
          this.applyFaceHead(delta);
        } else if (this.activePoints.has("nose")) {
          const nose = this.points.get("nose");
          const headTarget = nose.clone().add(new THREE.Vector3(0, 0.18, 0.02));
          this.head.position.lerp(headTarget, Math.min(delta * 10, 1));

          const look = new THREE.Vector3().subVectors(nose, shoulderMid);
          const yaw = THREE.MathUtils.clamp(look.x * 0.9, -0.6, 0.6);
          const pitch = THREE.MathUtils.clamp(-(look.y - 0.45) * 0.8, -0.45, 0.45);
          const targetQuat = new THREE.Quaternion().setFromEuler(
            new THREE.Euler(pitch, yaw, 0, "YXZ")
          );
          this.head.quaternion.slerp(targetQuat, Math.min(delta * 8, 1));

          this.neck.visible = true;
          setCylinderBetween(this.neck, shoulderMid, this.head.position);
        } else {
          this.neck.visible = false;
        }
        this.head.scale.setScalar(Math.max(0.8, shoulderWidth * 0.45));
      }
    }

    this.updateHandRigs(delta);
  }

  hideHandRigs() {
    Object.values(this.hands).forEach((rig) => {
      rig.active = false;
      rig.segments.forEach(({ mesh }) => {
        mesh.visible = false;
      });
      rig.tips.forEach((tip) => {
        tip.visible = false;
      });
    });
  }

  updateHandRigs(delta) {
    const now = performance.now();
    Object.entries(this.hands).forEach(([side, rig]) => {
      const tracking = rig.active && now - this.latestHandTrackedAt[side] <= 900;
      if (!tracking) {
        rig.segments.forEach(({ mesh }) => {
          mesh.visible = false;
        });
        rig.tips.forEach((tip) => {
          tip.visible = false;
        });
        return;
      }

      rig.points.forEach((point, index) => {
        const target = rig.targets.get(index);
        const filter = rig.filters.get(index);
        point.set(
          filter.x.filter(target.x, delta),
          filter.y.filter(target.y, delta),
          filter.z.filter(target.z, delta)
        );
      });

      const visibleSet = new Set(Array.from({ length: 21 }, (_, index) => index));

      rig.segments.forEach(({ from, to, mesh }) => {
        const segment = resolveFingerSegment(
          from,
          to,
          (index) => rig.points.get(index),
          visibleSet
        );
        const start = rig.points.get(segment.from);
        const end = rig.points.get(segment.to);
        const visible = start.distanceTo(end) > 0.008;
        mesh.visible = visible;
        if (visible) setCylinderBetween(mesh, start, end);
      });

      rig.tips.forEach((tip, index) => {
        tip.visible = tracking;
        tip.position.copy(rig.points.get(index));
      });
    });
  }

  animate() {
    if (this.stopped || this.paused) {
      this.rafId = null;
      return;
    }
    const now = performance.now();
    const delta = Math.min((now - this.lastFrameAt) / 1000, 0.05);
    this.lastFrameAt = now;
    this.animateIdle(delta);
    this.updateRig(delta);
    this.syncAttachedModel?.(delta);
    this.frameBodyCamera();
    this.renderFrame();
    this.rafId = requestAnimationFrame(() => this.animate());
  }

  getViewportAspect() {
    const raw = getComputedStyle(document.documentElement).getPropertyValue("--viz-aspect").trim();
    const parsed = Number.parseFloat(raw);
    return parsed > 0 ? parsed : 9 / 16;
  }

  updateViewportRect() {
    const containerW = Math.max(this.mount.clientWidth, 1);
    const containerH = Math.max(this.mount.clientHeight, 1);

    if (!this.framedViewport) {
      this._viewport = { x: 0, y: 0, width: containerW, height: containerH };
      this.camera.aspect = containerW / containerH;
      this.camera.updateProjectionMatrix();
      return;
    }

    const rect = containRect(this.getViewportAspect(), 1, containerW, containerH);
    this._viewport = rect;
    this.camera.aspect = rect.width / Math.max(rect.height, 1);
    this.camera.updateProjectionMatrix();
  }

  renderFrame() {
    const containerW = Math.max(this.mount.clientWidth, 1);
    const containerH = Math.max(this.mount.clientHeight, 1);
    this.renderer.setScissorTest(false);
    this.renderer.setViewport(0, 0, containerW, containerH);
    this.renderer.setClearColor(this.scene.background);
    this.renderer.clear(true, true, true);

    if (this.framedViewport && this._viewport.width > 0 && this._viewport.height > 0) {
      const { x, y, width, height } = this._viewport;
      const vpY = containerH - y - height;
      this.renderer.setScissorTest(true);
      this.renderer.setScissor(x, vpY, width, height);
      this.renderer.setViewport(x, vpY, width, height);
    }

    this.renderer.render(this.scene, this.camera);
    this.renderer.setScissorTest(false);
  }

  setPaused(paused) {
    if (this.stopped || this.paused === paused) return;
    this.paused = paused;
    if (!paused) {
      this.lastFrameAt = performance.now();
      if (!this.rafId) this.animate();
    }
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

  collectFramingPoints() {
    const points = [];
    const bodyActive = performance.now() - this.latestTrackedAt <= 900;

    if (bodyActive) {
      this.activePoints.forEach((name) => {
        const point = this.points.get(name);
        if (point) points.push(point);
      });
    }

    if (this.isFaceActive()) {
      this.faceVisible.forEach((name) => {
        const point = this.facePoints.get(name);
        if (point) points.push(point);
      });
    }

    ["left", "right"].forEach((side) => {
      if (!this.isHandSideActive(side)) return;
      this.hands[side].points.forEach((point) => points.push(point));
    });

    return points;
  }

  frameCameraToPoints(points, { spanScale = 1 } = {}) {
    if (!points.length) {
      this.frameBodyCameraDefault();
      return;
    }

    const aspect = this.framedViewport ? this.getViewportAspect() : this.camera.aspect;
    const viewW =
      this.framedViewport && this._viewport.width > 0
        ? this._viewport.width
        : Math.max(this.mount.clientWidth, 1);
    const viewH =
      this.framedViewport && this._viewport.height > 0
        ? this._viewport.height
        : Math.max(this.mount.clientHeight, 1);
    const pad = 16;

    let minXWorld = Infinity;
    let maxXWorld = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let sumZ = 0;

    points.forEach((point) => {
      minXWorld = Math.min(minXWorld, point.x);
      maxXWorld = Math.max(maxXWorld, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      sumZ += point.z;
    });

    const spanXWorld = Math.max((maxXWorld - minXWorld) * spanScale, 0.35);
    const spanY = Math.max((maxY - minY) * spanScale, 0.35);
    const lookX = (minXWorld + maxXWorld) * 0.5;
    const lookY = (minY + maxY) * 0.5;
    const lookZ = sumZ / points.length;
    const marginY = viewH / Math.max(viewH - pad * 2, 1);
    const marginX = viewW / Math.max(viewW - pad * 2, 1);

    const vFovRad = (this.camera.fov * Math.PI) / 180;
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * Math.max(this.camera.aspect, 0.01));
    const distV = (spanY * marginY) / (2 * Math.tan(vFovRad / 2));
    const distH = (spanXWorld * marginX) / (2 * Math.tan(hFovRad / 2));
    const distance = Math.max(Math.max(distV, distH), 1.4);

    this.camera.position.set(lookX, lookY, lookZ + distance);
    this.camera.lookAt(lookX, lookY, lookZ);
  }

  frameBodyCameraDefault() {
    let lookY = 0.42;
    let lookZ = -0.48;
    let bodySpan = 2.45;

    const bodyTracking = performance.now() - this.latestTrackedAt <= 900;
    if (bodyTracking && this.activePoints.size > 0) {
      let minY = Infinity;
      let maxY = -Infinity;
      let minZ = Infinity;
      let maxZ = -Infinity;

      this.activePoints.forEach((name) => {
        const point = this.points.get(name);
        if (!point) return;
        minY = Math.min(minY, point.y);
        maxY = Math.max(maxY, point.y);
        minZ = Math.min(minZ, point.z);
        maxZ = Math.max(maxZ, point.z);
      });

      if (Number.isFinite(minY) && Number.isFinite(maxY)) {
        lookY = (minY + maxY) * 0.5;
        lookZ = (minZ + maxZ) * 0.5;
        bodySpan = Math.max(maxY - minY, 1.35);
      }
    }

    const vFovRad = (this.camera.fov * Math.PI) / 180;
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * this.camera.aspect);
    const distV = (bodySpan * 0.92) / (2 * Math.tan(vFovRad / 2));
    const distH = (bodySpan * 0.62) / (2 * Math.tan(hFovRad / 2));
    const distance = Math.max(Math.max(distV, distH), 1.4);
    this.camera.position.set(0, lookY, lookZ + distance);
    this.camera.lookAt(0, lookY, lookZ);
  }

  frameBodyCamera() {
    if (this.framedViewport) {
      const points = this.collectFramingPoints();
      if (points.length) {
        this.frameCameraToPoints(points);
        return;
      }
    }

    this.frameBodyCameraDefault();
  }

  resize() {
    const width = Math.max(this.mount.clientWidth, 1);
    const height = Math.max(this.mount.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.updateViewportRect();
  }
}
