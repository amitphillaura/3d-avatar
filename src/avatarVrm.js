import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMHumanBoneName } from "@pixiv/three-vrm";

// Lazy-import Kalidokit (CommonJS module — may need .default unwrap)
let Face, Pose, Hand;
async function loadKalidokit() {
  if (Face) return;
  const mod = await import("kalidokit");
  const kit = mod.default ?? mod;
  Face = kit.Face;
  Pose = kit.Pose;
  Hand = kit.Hand;
}

/**
 * Apply a Kalidokit rotation result to a VRM humanoid bone.
 */
function rigRotation(vrm, name, rotation, dampener = 1, lerpAmount = 0.3) {
  const boneName = VRMHumanBoneName[name];
  if (!boneName) return;
  const Part = vrm.humanoid.getRawBoneNode(boneName);
  if (!Part) return;
  const euler = new THREE.Euler(
    rotation.x * dampener,
    rotation.y * dampener,
    rotation.z * dampener
  );
  const quaternion = new THREE.Quaternion().setFromEuler(euler);
  Part.quaternion.slerp(quaternion, lerpAmount);
}

/**
 * VRM Avatar — same public API as MushyAvatar so RigHost can swap it in.
 *
 * Loads /vrm/default.vrm and drives it via Kalidokit + @pixiv/three-vrm each
 * frame from MediaPipe Holistic landmarks.
 */
export class VrmAvatar {
  constructor(mountEl, metaEl, options = {}) {
    this._mount = mountEl;
    this._meta = metaEl;
    this._vrm = null;
    this._clock = new THREE.Clock();
    this._rafId = null;
    this._disposed = false;

    // --- Three.js scene setup ---
    const width = mountEl.clientWidth || 640;
    const height = mountEl.clientHeight || 480;

    this._renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this._renderer.setPixelRatio(window.devicePixelRatio);
    this._renderer.setSize(width, height);
    this._renderer.outputColorSpace = THREE.SRGBColorSpace;
    mountEl.appendChild(this._renderer.domElement);

    this._scene = new THREE.Scene();

    this._camera = new THREE.PerspectiveCamera(35, width / height, 0.1, 100);
    this._camera.position.set(0, 1.4, 2.5);
    this._camera.lookAt(new THREE.Vector3(0, 1.0, 0));

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1, 2, 3);
    this._scene.add(dirLight);
    this._scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    // Resize observer
    this._resizeObserver = new ResizeObserver(() => this._onResize());
    this._resizeObserver.observe(mountEl);

    // Placeholder text while VRM loads
    this._placeholder = document.createElement("div");
    this._placeholder.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;" +
      "color:#888;font-size:14px;pointer-events:none;";
    this._placeholder.textContent = "Loading VRM…";
    mountEl.style.position = "relative";
    mountEl.appendChild(this._placeholder);

    // Start async load
    this._loadVrm();
  }

  async _loadVrm() {
    await loadKalidokit();

    const loader = new GLTFLoader();
    loader.register((parser) => new VRMLoaderPlugin(parser));

    try {
      const gltf = await new Promise((resolve, reject) => {
        loader.load(
          "/vrm/default.vrm",
          resolve,
          undefined,
          reject
        );
      });

      if (this._disposed) return;

      const vrm = gltf.userData.vrm;
      if (!vrm) throw new Error("No VRM data found in loaded file.");

      this._vrm = vrm;
      this._scene.add(vrm.scene);

      // Remove placeholder
      this._placeholder.textContent = "";

      if (this._meta) this._meta.textContent = "VRM Avatar · ready";
    } catch (err) {
      if (this._disposed) return;
      console.warn("[VrmAvatar] VRM load failed:", err.message ?? err);
      this._placeholder.textContent = "No VRM loaded — place default.vrm in /public/vrm/";
      if (this._meta) this._meta.textContent = "VRM Avatar · no model";
    }

    // Start render loop regardless (renders empty scene or placeholder)
    this._startLoop();
  }

  _startLoop() {
    if (this._rafId !== null || this._disposed) return;
    const loop = () => {
      if (this._disposed) return;
      this._rafId = requestAnimationFrame(loop);
      const delta = this._clock.getDelta();
      if (this._vrm) this._vrm.update(delta);
      this._renderer.render(this._scene, this._camera);
    };
    this._rafId = requestAnimationFrame(loop);
  }

  _onResize() {
    if (this._disposed) return;
    const w = this._mount.clientWidth || 640;
    const h = this._mount.clientHeight || 480;
    this._camera.aspect = w / h;
    this._camera.updateProjectionMatrix();
    this._renderer.setSize(w, h);
  }

  // ── Public API ──────────────────────────────────────────────────────────

  updateTracking({ poseLandmarks, faceLandmarks, leftHandLandmarks, rightHandLandmarks, media } = {}) {
    if (!this._vrm || !Face || !Pose || !Hand) return;

    const vrm = this._vrm;

    // --- Face ---
    if (faceLandmarks && faceLandmarks.length) {
      try {
        const rigFace = Face.solve(faceLandmarks, {
          runtime: "mediapipe",
          video: media
        });
        if (rigFace) {
          const em = vrm.expressionManager;
          if (em) {
            em.setValue("blink", 1 - (rigFace.eye?.l ?? 1));
            em.setValue("blinkRight", 1 - (rigFace.eye?.r ?? 1));
            const mouthA = rigFace.mouth?.shape?.A ?? 0;
            em.setValue("aa", Math.abs(mouthA));
          }
        }
      } catch (_) { /* non-fatal */ }
    }

    // --- Pose ---
    if (poseLandmarks && poseLandmarks.length) {
      try {
        const rigPose = Pose.solve(poseLandmarks, poseLandmarks, {
          runtime: "mediapipe",
          video: media
        });
        if (rigPose) {
          // Hips
          if (rigPose.Hips?.rotation) {
            rigRotation(vrm, "Hips", rigPose.Hips.rotation, 0.7);
          }
          if (rigPose.Spine)   rigRotation(vrm, "Chest", rigPose.Spine, 0.25, 0.3);
          if (rigPose.Spine)   rigRotation(vrm, "Spine", rigPose.Spine, 0.45, 0.3);
          if (rigPose.Neck)    rigRotation(vrm, "Neck", rigPose.Neck, 0.7, 0.3);

          if (rigPose.RightUpperArm) rigRotation(vrm, "RightUpperArm", rigPose.RightUpperArm, 1, 0.3);
          if (rigPose.RightLowerArm) rigRotation(vrm, "RightLowerArm", rigPose.RightLowerArm, 1, 0.3);
          if (rigPose.LeftUpperArm)  rigRotation(vrm, "LeftUpperArm",  rigPose.LeftUpperArm,  1, 0.3);
          if (rigPose.LeftLowerArm)  rigRotation(vrm, "LeftLowerArm",  rigPose.LeftLowerArm,  1, 0.3);

          if (rigPose.RightUpperLeg) rigRotation(vrm, "RightUpperLeg", rigPose.RightUpperLeg, 1, 0.3);
          if (rigPose.RightLowerLeg) rigRotation(vrm, "RightLowerLeg", rigPose.RightLowerLeg, 1, 0.3);
          if (rigPose.LeftUpperLeg)  rigRotation(vrm, "LeftUpperLeg",  rigPose.LeftUpperLeg,  1, 0.3);
          if (rigPose.LeftLowerLeg)  rigRotation(vrm, "LeftLowerLeg",  rigPose.LeftLowerLeg,  1, 0.3);
        }
      } catch (_) { /* non-fatal */ }
    }

    // --- Hands ---
    if (leftHandLandmarks && leftHandLandmarks.length) {
      try {
        const rigLeft = Hand.solve(leftHandLandmarks, "Left");
        if (rigLeft) {
          rigRotation(vrm, "LeftHand", rigLeft.LeftWrist, 1, 0.3);
        }
      } catch (_) { /* non-fatal */ }
    }

    if (rightHandLandmarks && rightHandLandmarks.length) {
      try {
        const rigRight = Hand.solve(rightHandLandmarks, "Right");
        if (rigRight) {
          rigRotation(vrm, "RightHand", rigRight.RightWrist, 1, 0.3);
        }
      } catch (_) { /* non-fatal */ }
    }
  }

  clearTracking() {
    // Nothing to clear for VRM — bones will stay at last pose
  }

  setShowJointLabels(_bool) {
    // No-op for VRM
  }

  setZoom(value) {
    const z = Number(value) || 1;
    // Map zoom around default camera distance (2.5); zoom > 1 = closer
    this._camera.position.z = 2.5 / z;
    this._camera.lookAt(new THREE.Vector3(0, 1.0, 0));
  }

  setTrackFingers(_bool) {
    // No-op — finger tracking could be extended later
  }

  dispose() {
    this._disposed = true;
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }
    this._resizeObserver?.disconnect();
    this._renderer.dispose();
    if (this._renderer.domElement.parentNode) {
      this._renderer.domElement.parentNode.removeChild(this._renderer.domElement);
    }
    if (this._placeholder.parentNode) {
      this._placeholder.parentNode.removeChild(this._placeholder);
    }
  }
}
