/**
 * avatarDog.js — Procedural dog/quadruped avatar driven by AP-10K keypoints.
 *
 * Accepts { animalLandmarks: [{x, y, confidence}×17] } from updateTracking().
 * Ignores human poseLandmarks — pass-through is a no-op.
 *
 * Public API mirrors MushyAvatar so RigHost can swap it in transparently.
 */

import * as THREE from "three";
import { DOG_JOINTS, DOG_BONES } from "./dogSkeleton.js";
import { mapAnimalLandmark } from "./poseSkeleton.js";

const JOINT_RADIUS = 0.08;
const BONE_RADIUS  = 0.04;
const JOINT_COLOR  = 0x9e9e9e;
const BONE_COLOR   = 0x757575;
const CONFIDENCE_THRESHOLD = 0.25;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMaterial(color) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: 0.55,
    metalness: 0.1,
    emissive: color,
    emissiveIntensity: 0.07
  });
}

function setCylinderBetween(mesh, start, end) {
  const delta = new THREE.Vector3().subVectors(end, start);
  const length = Math.max(delta.length(), 0.001);
  mesh.position.copy(start).addScaledVector(delta, 0.5);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.clone().normalize());
}

// ---------------------------------------------------------------------------
// DogAvatar
// ---------------------------------------------------------------------------

export class DogAvatar {
  constructor(mountEl, metaEl, options = {}) {
    this.mount = mountEl;
    this.metaElement = metaEl;
    this.showJointLabels = Boolean(options.showJointLabels);
    this._positions = new Array(DOG_JOINTS.length).fill(null).map(() => new THREE.Vector3());
    this._visible   = new Array(DOG_JOINTS.length).fill(false);

    // Three.js scene --------------------------------------------------------
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06080e);

    this.camera = new THREE.PerspectiveCamera(38, 16 / 9, 0.1, 100);
    this.camera.position.set(0, 0, 5.5);
    this.camera.lookAt(0, 0, 0);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.mount.appendChild(this.renderer.domElement);

    this.root = new THREE.Group();
    this.root.position.y = -0.2;
    this.scene.add(this.root);

    // Lighting
    const ambient = new THREE.AmbientLight(0xffffff, 0.55);
    this.scene.add(ambient);
    const key = new THREE.DirectionalLight(0xffffff, 0.9);
    key.position.set(2, 4, 3);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0x8899ff, 0.35);
    fill.position.set(-3, 1, 2);
    this.scene.add(fill);

    // Build joint spheres
    this._jointMeshes = DOG_JOINTS.map(() => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(JOINT_RADIUS, 12, 8),
        makeMaterial(JOINT_COLOR)
      );
      mesh.visible = false;
      this.root.add(mesh);
      return mesh;
    });

    // Build bone cylinders
    const boneGeo = new THREE.CylinderGeometry(BONE_RADIUS, BONE_RADIUS, 1, 8);
    this._boneMeshes = DOG_BONES.map(() => {
      const mesh = new THREE.Mesh(boneGeo, makeMaterial(BONE_COLOR));
      mesh.visible = false;
      this.root.add(mesh);
      return mesh;
    });

    // "Dog" label (canvas sprite)
    this._buildLabel();

    this.resizeObserver = new ResizeObserver(() => this._resize());
    this.resizeObserver.observe(this.mount);
    this._resize();
    this._animate();
  }

  // -------------------------------------------------------------------------
  // Label sprite
  // -------------------------------------------------------------------------

  _buildLabel() {
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "rgba(0,0,0,0)";
    ctx.fillRect(0, 0, 256, 64);
    ctx.font = "bold 36px sans-serif";
    ctx.fillStyle = "#bdbdbd";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("Dog", 128, 32);

    const tex = new THREE.CanvasTexture(canvas);
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    this._labelSprite = new THREE.Sprite(mat);
    this._labelSprite.scale.set(1.6, 0.4, 1);
    this._labelSprite.position.set(0, 1.8, 0);
    this.root.add(this._labelSprite);
  }

  // -------------------------------------------------------------------------
  // Resize
  // -------------------------------------------------------------------------

  _resize() {
    const w = this.mount.clientWidth  || 640;
    const h = this.mount.clientHeight || 360;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // -------------------------------------------------------------------------
  // Render loop
  // -------------------------------------------------------------------------

  _animate() {
    if (this._disposed) return;
    this._rafId = requestAnimationFrame(() => this._animate());
    this.renderer.render(this.scene, this.camera);
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------

  /**
   * updateTracking({ animalLandmarks, poseLandmarks, ... })
   * Only animalLandmarks are consumed; human landmarks are ignored.
   */
  updateTracking(results = {}) {
    const lms = results.animalLandmarks;
    if (!Array.isArray(lms) || lms.length === 0) {
      // Not animal data — leave rig as-is (graceful passthrough for human results)
      return;
    }
    this.clearTracking();

    for (let i = 0; i < DOG_JOINTS.length; i++) {
      const lm = lms[i];
      if (!lm) continue;
      const conf = lm.confidence ?? 1;
      if (conf < CONFIDENCE_THRESHOLD) continue;
      mapAnimalLandmark(lm, this._positions[i]);
      this._visible[i] = true;
    }

    this._updateMeshes();
  }

  clearTracking() {
    this._visible.fill(false);
    for (const m of this._jointMeshes) m.visible = false;
    for (const m of this._boneMeshes) m.visible = false;
  }

  setShowJointLabels(/* bool */) {
    // No CSS2D labels implemented for dog avatar (kept minimal).
  }

  setZoom(value) {
    const z = Number(value) || 1;
    this.camera.position.z = 5.5 / z;
    this.camera.updateProjectionMatrix();
  }

  /** No-op — dogs have no fingers. */
  setTrackFingers(/* bool */) {}

  dispose() {
    this._disposed = true;
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this.resizeObserver?.disconnect();
    this.renderer.dispose();
    if (this.renderer.domElement.parentNode) {
      this.renderer.domElement.parentNode.removeChild(this.renderer.domElement);
    }
  }

  // -------------------------------------------------------------------------
  // Internal mesh update
  // -------------------------------------------------------------------------

  _updateMeshes() {
    // Joints
    for (let i = 0; i < DOG_JOINTS.length; i++) {
      const mesh = this._jointMeshes[i];
      if (this._visible[i]) {
        mesh.position.copy(this._positions[i]);
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }

    // Bones
    for (let b = 0; b < DOG_BONES.length; b++) {
      const [iA, iB] = DOG_BONES[b];
      const mesh = this._boneMeshes[b];
      if (this._visible[iA] && this._visible[iB]) {
        setCylinderBetween(mesh, this._positions[iA], this._positions[iB]);
        mesh.visible = true;
      } else {
        mesh.visible = false;
      }
    }
  }
}
