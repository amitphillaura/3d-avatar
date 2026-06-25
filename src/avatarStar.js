import * as THREE from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { HAND_CONNECTIONS, resolveFingerSegment } from "./handRig.js";
import { FACE_HEAD_KEYS, FACE_HEAD_LANDMARKS, solveFaceRig } from "./faceRig.js";
import { formatJointLabel } from "./jointLabels.js";
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

// Constellation / stardust being — point clouds for the body, glowing constellation struts.
const STAR_PALETTE = {
  star: 0xbfd8ff,
  glow: 0xffffff,
  line: 0x6a7bff,
  accent: 0x8a7bff
};

const BONE_STYLE = {
  collar: { radius: 0.012, color: STAR_PALETTE.line },
  hip: { radius: 0.012, color: STAR_PALETTE.line },
  arm: { radius: 0.01, color: STAR_PALETTE.line },
  leg: { radius: 0.012, color: STAR_PALETTE.line },
  side: { radius: 0.01, color: STAR_PALETTE.line }
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

// Additive glow material — faint constellation struts / glowing star-points on the dark sky.
function makeGlow(color, opacity = 0.85) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false
  });
}

// Build a THREE.Points cloud filling an ellipsoid (rx, ry, rz) with `count` stars.
function makeCloud(count, rx, ry, rz, color, size) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    // random point inside a unit sphere, scaled to the ellipsoid
    let x, y, z;
    do {
      x = Math.random() * 2 - 1;
      y = Math.random() * 2 - 1;
      z = Math.random() * 2 - 1;
    } while (x * x + y * y + z * z > 1);
    positions[i * 3] = x * rx;
    positions[i * 3 + 1] = y * ry;
    positions[i * 3 + 2] = z * rz;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({
    color,
    size,
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    sizeAttenuation: true
  });
  return new THREE.Points(geo, mat);
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

export class MushyStar {
  constructor(mount, metaElement, options = {}) {
    this.mount = mount;
    this.metaElement = metaElement;
    this.framedViewport = Boolean(options.framedViewport ?? mount?.id === "riggedModelMount");
    this.showJointLabels = Boolean(options.showJointLabels);
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
    this.zoom = 1; // camera zoom multiplier (>1 closer/bigger, <1 farther/smaller)
    this._mapScratch = new THREE.Vector3();
    this._handAssignA = new THREE.Vector3();
    this._handAssignB = new THREE.Vector3();
    this._torsoMid = new THREE.Vector3();
    this._toCamera = new THREE.Vector3();
    this._toJoint = new THREE.Vector3();
    this._jointLabelOffset = new THREE.Vector3(0, 0.11, 0);
    this.jointLabels = new Map();
    this.jointLabelLayer = new THREE.Group();
    this.labelRenderer = null;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x05060f);

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    this.frameBodyCamera();

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mount.appendChild(this.renderer.domElement);

    this.root = new THREE.Group();
    this.root.position.y = -0.15;
    this.scene.add(this.root);
    this.root.add(this.jointLabelLayer);

    this.createLights();
    this.createWorld();
    this.createRig();
    this.hands = {
      left: this.buildHandRig(STAR_PALETTE.star),
      right: this.buildHandRig(STAR_PALETTE.star)
    };
    this.resize();

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(this.mount);
    if (this.showJointLabels) {
      this.ensureJointLabels();
      this.applySkeletonVisibility();
    }
    this.animate();
  }

  initJointLabelRenderer() {
    this.labelRenderer = new CSS2DRenderer();
    const el = this.labelRenderer.domElement;
    el.className = "rig-joint-label-layer";
    el.style.position = "absolute";
    el.style.pointerEvents = "none";
    this.mount.appendChild(el);
    this.syncLabelRendererLayout();
  }

  /** Match CSS2D overlay to the same letterbox rect as the WebGL viewport. */
  syncLabelRendererLayout() {
    if (!this.labelRenderer) return;

    const containerW = Math.max(this.mount.clientWidth, 1);
    const containerH = Math.max(this.mount.clientHeight, 1);
    const el = this.labelRenderer.domElement;

    if (this.framedViewport && this._viewport.width > 0 && this._viewport.height > 0) {
      const { x, y, width, height } = this._viewport;
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;
      el.style.width = `${width}px`;
      el.style.height = `${height}px`;
      this.labelRenderer.setSize(width, height);
      return;
    }

    el.style.left = "0";
    el.style.top = "0";
    el.style.width = `${containerW}px`;
    el.style.height = `${containerH}px`;
    this.labelRenderer.setSize(containerW, containerH);
  }

  addJointLabel(name) {
    if (this.jointLabels.has(name)) return;
    const element = document.createElement("div");
    element.className = "rig-joint-label";
    element.textContent = formatJointLabel(name);
    const label = new CSS2DObject(element);
    label.visible = false;
    this.jointLabelLayer.add(label);
    this.jointLabels.set(name, label);
  }

  ensureJointLabels() {
    if (!this.labelRenderer) this.initJointLabelRenderer();
    this.joints.forEach((_, name) => this.addJointLabel(name));
    Object.keys(this.caps).forEach((name) => this.addJointLabel(name));
  }

  setShowJointLabels(value) {
    const next = Boolean(value);
    if (this.showJointLabels === next) return;
    this.showJointLabels = next;
    if (next) {
      this.ensureJointLabels();
      if (this.labelRenderer) this.labelRenderer.domElement.style.display = "";
    } else {
      this.jointLabels.forEach((label) => {
        label.visible = false;
      });
      // CSS2D labels only update their DOM on render(); once we stop rendering the
      // overlay (showJointLabels=false) the last-shown labels would freeze on screen.
      // Hide the whole overlay so toggling off actually clears them.
      if (this.labelRenderer) this.labelRenderer.domElement.style.display = "none";
    }
    this.applySkeletonVisibility();
  }

  /** When labels are on, hide joint spheres — same idea as Full Skeleton label mode. */
  applySkeletonVisibility() {
    const hideMarkers = this.showJointLabels;
    this.joints.forEach((joint, name) => {
      if (hideMarkers) joint.visible = false;
      else joint.visible = this.activePoints.has(name);
    });
    Object.entries(this.caps).forEach(([name, cap]) => {
      if (hideMarkers) cap.visible = false;
      else cap.visible = this.activePoints.has(name);
    });
  }

  writeTorsoMid(out) {
    if (
      !this.activePoints.has("leftShoulder") ||
      !this.activePoints.has("rightShoulder") ||
      !this.activePoints.has("leftHip") ||
      !this.activePoints.has("rightHip")
    ) {
      return null;
    }
    this._handAssignA
      .copy(this.points.get("leftShoulder"))
      .add(this.points.get("rightShoulder"))
      .multiplyScalar(0.5);
    this._handAssignB.copy(this.points.get("leftHip")).add(this.points.get("rightHip")).multiplyScalar(0.5);
    return out.addVectors(this._handAssignA, this._handAssignB).multiplyScalar(0.5);
  }

  /** F = joint toward the camera; B = toward the back. */
  jointFacingCode(name) {
    const point = this.points.get(name);
    if (!point || !this.writeTorsoMid(this._torsoMid)) return null;

    this._toCamera.subVectors(this.camera.position, this._torsoMid);
    if (this._toCamera.lengthSq() < 1e-8) return null;
    this._toCamera.normalize();

    this._toJoint.subVectors(point, this._torsoMid);
    if (this._toJoint.lengthSq() < 1e-6) return null;

    const dot = this._toJoint.dot(this._toCamera);
    if (Math.abs(dot) < 0.015) return null;
    return dot > 0 ? "F" : "B";
  }

  updateJointLabels() {
    if (!this.showJointLabels || !this.labelRenderer) return;
    this.jointLabels.forEach((label, name) => {
      const active = this.activePoints.has(name);
      label.visible = active;
      if (!active) return;
      label.position.copy(this.points.get(name)).add(this._jointLabelOffset);

      const facing = this.jointFacingCode(name);
      const base = formatJointLabel(name);
      label.element.textContent = facing ? `${base} (${facing})` : base;
      label.element.classList.toggle("rig-joint-label--front", facing === "F");
      label.element.classList.toggle("rig-joint-label--back", facing === "B");
    });
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
    // Joints = tiny glowing star-points so limbs read as a constellation.
    const jointGeometry = new THREE.SphereGeometry(0.03, 10, 8);
    const jointMaterial = makeGlow(STAR_PALETTE.glow, 0.9);

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

    // End-caps so wrists read as hands and ankles as feet — tiny glow spheres.
    const handGeometry = new THREE.SphereGeometry(0.045, 10, 8);
    const footGeometry = new THREE.SphereGeometry(0.05, 10, 8);
    const handMaterial = makeGlow(STAR_PALETTE.star, 0.9);
    const footMaterial = makeGlow(STAR_PALETTE.star, 0.9);
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

    // Neck connects the torso/shoulders to the head — a thin glowing strut.
    const neckStyle = BONE_STYLE.collar;
    this.neck = new THREE.Mesh(
      new THREE.CylinderGeometry(neckStyle.radius * 0.7, neckStyle.radius * 0.9, 1, 8),
      makeGlow(STAR_PALETTE.line, 0.7)
    );
    this.neck.visible = false;
    this.root.add(this.neck);

    BONES.forEach(([from, to, variant]) => {
      const style = BONE_STYLE[variant];
      const geometry = new THREE.CylinderGeometry(style.radius, style.radius, 1, 8);
      const material = makeGlow(style.color, 0.55);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.visible = false;
      this.root.add(mesh);
      this.bones.push({ from, to, mesh });
    });

    // Base torso/head meshes stay in the tree (their .position keeps updating every frame)
    // but are fully transparent — the point clouds below render the actual body.
    this.torso = new THREE.Mesh(
      new THREE.SphereGeometry(0.82, 16, 16),
      new THREE.MeshStandardMaterial({ color: STAR_PALETTE.star })
    );
    this.torso.scale.set(0.85, 1.15, 0.36);
    this.torso.material.transparent = true;
    this.torso.material.opacity = 0;
    this.root.add(this.torso);

    this.head = new THREE.Mesh(
      new THREE.SphereGeometry(0.32, 16, 16),
      new THREE.MeshStandardMaterial({ color: STAR_PALETTE.star })
    );
    this.head.material.transparent = true;
    this.head.material.opacity = 0;
    this.root.add(this.head);

    // THE TECHNIQUE — point-cloud body. Anchored to head/torso .position in syncAttachedModel.
    this._headCloud = makeCloud(120, 0.34, 0.34, 0.34, STAR_PALETTE.star, 0.05);
    this._torsoCloud = makeCloud(220, 0.55, 0.7, 0.4, STAR_PALETTE.star, 0.05);
    this.root.add(this._headCloud);
    this.root.add(this._torsoCloud);
    this._clouds = [this._headCloud, this._torsoCloud];

    // Eyes = two slightly bigger bright glow spheres on the head front.
    const eyeMaterial = makeGlow(STAR_PALETTE.glow, 0.95);
    this.leftEye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), eyeMaterial);
    this.rightEye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 12), eyeMaterial);
    this.head.add(this.leftEye, this.rightEye);
    this.leftEye.position.set(-0.105, 0.06, 0.29);
    this.rightEye.position.set(0.105, 0.06, 0.29);

    // Antenna = a small glowing star (octahedron) on top of the head.
    this.antenna = new THREE.Group();
    this.antenna.position.set(0, 0.33, 0);
    const starTip = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.07, 0),
      makeGlow(STAR_PALETTE.accent, 0.95)
    );
    this.antenna.add(starTip);
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
    this.metaElement.textContent = `MushyStar tracking · ${parts.join(" · ")}`;
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
    // MediaPipe (and the "Swap Hands (L/R)" toggle) can mislabel which set is the left vs
    // right hand. Anchoring an arm to a mislabeled hand drags the whole forearm across the
    // body — the crossed-arms bug. Re-assign each hand set to the pose wrist it is
    // physically closest to so the rig is correct regardless of the label. Pose and hand
    // landmarks share the same x/y mapping, so image-plane distance is comparable.
    if (
      this.activePoints.has("leftWrist") &&
      this.activePoints.has("rightWrist") &&
      leftHandLandmarks?.[0] &&
      rightHandLandmarks?.[0]
    ) {
      const lw = this.targetPoints.get("leftWrist");
      const rw = this.targetPoints.get("rightWrist");
      const L = this.mapHandLandmark(leftHandLandmarks[0], this._handAssignA);
      const R = this.mapHandLandmark(rightHandLandmarks[0], this._handAssignB);
      const xy = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
      if (xy(L, rw) + xy(R, lw) < xy(L, lw) + xy(R, rw)) {
        const tmp = leftHandLandmarks;
        leftHandLandmarks = rightHandLandmarks;
        rightHandLandmarks = tmp;
      }
    }
    this.updateHandSide("left", leftHandLandmarks);
    this.updateHandSide("right", rightHandLandmarks);
  }

  updateTracking({ poseLandmarks, faceLandmarks, leftHandLandmarks, rightHandLandmarks, media } = {}) {
    this.updatePose(poseLandmarks);
    this.updateFace(faceLandmarks, media);
    this.updateHands(leftHandLandmarks, rightHandLandmarks);
    this.refreshMeta();
  }

  // Explicit reset (source switch / stop). Distinct from a paused video: when tracking
  // merely goes stale the rig HOLDS its last pose, but clearTracking() forces idle/bind.
  clearTracking() {
    this.latestTrackedAt = 0;
    this.latestFaceTrackedAt = 0;
    this.latestHandTrackedAt = { left: 0, right: 0 };
    this.activePoints.clear();
    this.faceVisible.clear();
    this.faceRig = null;
    Object.values(this.hands).forEach((rig) => {
      rig.active = false;
    });
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
      // Paused video / brief dropout (was tracked): HOLD the last pose so the rig
      // freezes on the frame like the Full Skeleton, instead of dropping to idle.
      // Only fall back to the idle "waiting" animation on an explicit clear.
      if (this.latestTrackedAt !== 0) return;

      this.activePoints.clear();
      this.metaElement.textContent = "MushyStar waiting for your body pose";
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
        joint.visible = !this.showJointLabels && this.activePoints.has(name);
      });

      this.bones.forEach(({ from, to, mesh }) => {
        const start = this.points.get(from);
        const end = this.points.get(to);
        mesh.visible =
          this.activePoints.has(from) && this.activePoints.has(to) && start.distanceTo(end) > 0.05;
        setCylinderBetween(mesh, start, end);
      });

      Object.entries(this.caps).forEach(([name, cap]) => {
        cap.visible = !this.showJointLabels && this.activePoints.has(name);
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
    this.updateJointLabels();
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

    if (this.labelRenderer && this.showJointLabels) {
      this.syncLabelRendererLayout();
      this.labelRenderer.render(this.scene, this.camera);
    }
  }

  setZoom(value) {
    const v = Number(value);
    this.zoom = Number.isFinite(v) ? Math.min(Math.max(v, 0.5), 2) : 1;
  }

  // Stardust body: anchor the point clouds to the body and twinkle them each frame.
  syncAttachedModel(delta) {
    if (!this._clouds) return;
    this._headCloud.position.copy(this.head.position);
    this._torsoCloud.position.copy(this.torso.position);
    const t = (performance.now() - this.startedAt) / 1000;
    this._clouds.forEach((c, i) => {
      c.material.opacity = 0.7 + 0.25 * Math.sin(t * 3 + i);
      c.rotation.y = t * 0.2 * (i ? 1 : -1);
    });
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
    if (this.labelRenderer) {
      if (this.labelRenderer.domElement.parentNode === this.mount) {
        this.mount.removeChild(this.labelRenderer.domElement);
      }
      this.labelRenderer = null;
    }
    this.jointLabels.clear();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode === this.mount) {
      this.mount.removeChild(this.renderer.domElement);
    }
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
    const distance = Math.max(Math.max(distV, distH), 1.4) / (this.zoom || 1);
    this.camera.position.set(0, lookY, lookZ + distance);
    this.camera.lookAt(0, lookY, lookZ);
  }

  frameBodyCamera() {
    if (this.framedViewport) {
      this.frameBodyCameraFixed();
      return;
    }

    this.frameBodyCameraDefault();
  }

  // Constant framing over the bounded Mushy landmark space. `mapPoseLandmark` maps
  // normalized landmarks into a fixed range, so a single deterministic camera always
  // contains a standing figure — it never jitters and the subject stays in frame even
  // while paused. (Replaces the old per-frame frameCameraToPoints follow that "zoomed
  // all over" because it re-fit the noisy landmark bounding box every frame.)
  frameBodyCameraFixed() {
    const centerX = 0;
    const centerY = 0.38;
    const centerZ = -0.65;
    const halfX = 1.3; // torso + arms; fully-extended arms may transiently approach the edge
    const halfY = 2.2; // head-to-feet of a standing figure

    const vFovRad = (this.camera.fov * Math.PI) / 180;
    const hFovRad = 2 * Math.atan(Math.tan(vFovRad / 2) * Math.max(this.camera.aspect, 0.01));
    const distV = halfY / Math.tan(vFovRad / 2);
    const distH = halfX / Math.tan(hFovRad / 2);
    const distance = Math.max(distV, distH, 1.4) / (this.zoom || 1);

    this.camera.position.set(centerX, centerY, centerZ + distance);
    this.camera.lookAt(centerX, centerY, centerZ);
  }

  resize() {
    const width = Math.max(this.mount.clientWidth, 1);
    const height = Math.max(this.mount.clientHeight, 1);
    this.renderer.setSize(width, height, false);
    this.updateViewportRect();
    this.syncLabelRendererLayout();
  }
}
