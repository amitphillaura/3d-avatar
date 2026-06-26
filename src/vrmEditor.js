/**
 * vrmEditor.js — VRM Editor module for 3D Avatar Studio
 *
 * Entry point: initVrmEditor()
 * Called once on page load from the inline script in index.html.
 * Manages its own Three.js renderer, VRM loading, expression sliders,
 * spring-bone physics controls, live MediaPipe capture, and camera presets.
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMHumanBoneName } from '@pixiv/three-vrm';
import {
  createVRMAnimationClip,
  VRMAnimationLoaderPlugin,
  VRMLookAtQuaternionProxy,
} from '@pixiv/three-vrm-animation';
import { navigate } from './router.js';

// ─── Module-level state ───────────────────────────────────────────────────────

let vrm = null;
let renderer = null;
let scene = null;
let camera = null;
let controls = null;
let lastFrameTime = 0;
let rafId = null;
let springEnabled = true;
let captureActive = false;
let holisticInstance = null;
let cameraStream = null;
let captureVideo = null;
let captureObjectUrl = null;
let currentFileName = '';
let exprSliders = {};

// ── Motion record / replay ──
// Bones and expressions that capture drives — the set we snapshot per frame.
const RECORDED_BONES = [
  'Neck', 'Head', 'Hips', 'Chest', 'Spine',
  'RightUpperArm', 'RightLowerArm', 'LeftUpperArm', 'LeftLowerArm',
  'LeftHand', 'RightHand',
];
const RECORDED_EXPR = ['blink', 'blinkLeft', 'blinkRight'];
let recording = false;
let recordedFrames = [];     // [{ t, bones:{name:[x,y,z,w]}, expr:{name:val} }]
let recordStartTime = 0;
let playingRecording = false;
let replayStartTime = 0;
const _qa = new THREE.Quaternion();
const _qb = new THREE.Quaternion();
let vrmAnimationMixer = null;
let vrmAnimationAction = null;
let activeAnimationId = null;
let activeAnimationBasePose = null;
let activeAnimationBaseExpressions = null;
let activeAnimationBaseLookAt = null;
const vrmAnimationCache = new Map();
const ANIMATION_PRESETS = [
  {
    id: 'pixiv-test',
    label: 'Pixiv Test',
    url: '/vrma/pixiv-test.vrma',
    keywords: 'official pixiv sample vrma motion authored',
  },
  {
    id: 'vroid-show-full-body',
    label: 'Show full body',
    url: '/vrma/vroid/show-full-body.vrma',
    keywords: 'vroid official vrma full body',
  },
  {
    id: 'vroid-greeting',
    label: 'Greeting',
    url: '/vrma/vroid/greeting.vrma',
    keywords: 'vroid official vrma greeting hello wave',
  },
  {
    id: 'vroid-peace-sign',
    label: 'Peace sign',
    url: '/vrma/vroid/peace-sign.vrma',
    keywords: 'vroid official vrma peace sign pose',
  },
  {
    id: 'vroid-shoot',
    label: 'Shoot',
    url: '/vrma/vroid/shoot.vrma',
    keywords: 'vroid official vrma shoot action',
  },
  {
    id: 'vroid-spin',
    label: 'Spin',
    url: '/vrma/vroid/spin.vrma',
    keywords: 'vroid official vrma spin turn',
  },
  {
    id: 'vroid-model-pose',
    label: 'Model pose',
    url: '/vrma/vroid/model-pose.vrma',
    keywords: 'vroid official vrma model pose',
  },
  {
    id: 'vroid-squat',
    label: 'Squat',
    url: '/vrma/vroid/squat.vrma',
    keywords: 'vroid official vrma squat exercise',
  },
];

// Kalidokit solvers — loaded once via dynamic import on first use
let KFace = null;
let KPose = null;
let KHand = null;

async function loadKalidokit() {
  if (KFace) return;
  try {
    const mod = await import('kalidokit');
    const kit = mod.default ?? mod;
    KFace = kit.Face;
    KPose = kit.Pose;
    KHand = kit.Hand;
  } catch (err) {
    console.warn('[VRM Editor] Kalidokit failed to load:', err.message);
  }
}

// Kick off Kalidokit load immediately so it's ready when live capture starts
loadKalidokit();

// ─── Three.js Setup ───────────────────────────────────────────────────────────

function setupThree(viewportEl) {
  const w = viewportEl.clientWidth || 800;
  const h = viewportEl.clientHeight || 600;

  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(w, h);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  viewportEl.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x080b10, 0.04);

  camera = new THREE.PerspectiveCamera(35, w / h, 0.1, 100);
  camera.position.set(0, 1.4, 3);
  camera.lookAt(0, 1.0, 0);

  // Hemisphere light (sky / ground)
  const hemi = new THREE.HemisphereLight(0xb8d4ff, 0x2a1a3e, 0.6);
  scene.add(hemi);

  // Main directional light with shadows
  const dir = new THREE.DirectionalLight(0xffffff, 1.4);
  dir.position.set(2, 4, 3);
  dir.castShadow = true;
  dir.shadow.mapSize.width = 1024;
  dir.shadow.mapSize.height = 1024;
  scene.add(dir);

  // Fill / rim light
  const fill = new THREE.DirectionalLight(0x9966ff, 0.3);
  fill.position.set(-2, 1, -2);
  scene.add(fill);

  // Grid
  const grid = new THREE.GridHelper(8, 16, 0x252c38, 0x1a2030);
  grid.position.y = 0;
  scene.add(grid);

  // OrbitControls
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.target.set(0, 1.0, 0);
  controls.minDistance = 0.5;
  controls.maxDistance = 8;
  controls.update();
}

// ─── Render Loop ──────────────────────────────────────────────────────────────

function startRenderLoop() {
  if (rafId) return;
  lastFrameTime = 0;
  function loop() {
    rafId = requestAnimationFrame(loop);
    // Manual frame delta (seconds). Avoids THREE.Clock, which is deprecated in
    // recent three.js and logs a console warning on construction.
    const now = performance.now();
    const delta = lastFrameTime ? (now - lastFrameTime) / 1000 : 0;
    lastFrameTime = now;
    controls?.update();
    if (vrmAnimationMixer) vrmAnimationMixer.update(delta);
    if (playingRecording) applyRecordedPose(now - replayStartTime);
    if (vrm) {
      vrm.update(delta);
    }
    renderer.render(scene, camera);
  }
  loop();
}

function stopRenderLoop() {
  if (rafId) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
}

function handleResize() {
  const vp = document.getElementById('vrm-viewport');
  if (!vp || !renderer || !camera) return;
  const w = vp.clientWidth;
  const h = vp.clientHeight;
  if (w === 0 || h === 0) return;
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

// ─── VRM Loading ──────────────────────────────────────────────────────────────

// First non-whitespace byte is '<' → an HTML document (e.g. an SPA fallback
// page served when the requested model file doesn't exist). VRM files start
// with the GLB magic ('glTF') or a JSON '{', never '<'.
function looksLikeHtml(buffer) {
  const bytes = new Uint8Array(buffer.slice(0, 64));
  let i = 0;
  // Skip whitespace and a UTF-8 BOM.
  while (i < bytes.length && [0x20, 0x09, 0x0a, 0x0d, 0xef, 0xbb, 0xbf].includes(bytes[i])) i++;
  return bytes[i] === 0x3c;
}

async function loadVrmFromUrl(url, filename) {
  showLoadingState(true);
  stopActiveVrmAnimation();
  try {
    // Fetch the bytes ourselves so we can give a clear error. If we handed a bad
    // URL straight to GLTFLoader, a missing file (server returns index.html) would
    // surface as a cryptic "Unexpected token '<'" JSON parse error.
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Couldn't load model (HTTP ${resp.status}).`);
    const buffer = await resp.arrayBuffer();
    if (looksLikeHtml(buffer)) {
      throw new Error('No model found there. Drag a .vrm file onto the viewport, or use Load File.');
    }

    const loader = new GLTFLoader();
    loader.register(parser => new VRMLoaderPlugin(parser));
    const gltf = await loader.parseAsync(buffer, '');
    const newVrm = gltf.userData.vrm;
    if (!newVrm) throw new Error('That file isn\'t a valid VRM model.');

    // Dispose old VRM geometry / materials
    if (vrm) {
      scene.remove(vrm.scene);
      vrm.scene.traverse(obj => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          const mats = Array.isArray(obj.material) ? obj.material : [obj.material];
          mats.forEach(m => m.dispose());
        }
      });
    }

    vrm = newVrm;
    // VRM models face away from the camera by default — rotate 180° to face forward
    vrm.scene.rotation.y = Math.PI;
    scene.add(vrm.scene);

    currentFileName = filename || url.split('/').pop();
    updateFilenamePill(currentFileName);
    hideDropZone();
    buildExpressionSliders();
    populateMetaPanel();
    showLoadingState(false);
  } catch (err) {
    console.error('[VRM Editor] load error:', err);
    showLoadingState(false);
    showError(err.message);
  }
}

async function loadVrmFile(file) {
  const url = URL.createObjectURL(file);
  await loadVrmFromUrl(url, file.name);
  URL.revokeObjectURL(url);
}

// ─── Expression Sliders ───────────────────────────────────────────────────────

function buildExpressionSliders() {
  const container = document.getElementById('vrm-expr-container');
  if (!container || !vrm?.expressionManager) return;
  container.innerHTML = '';
  exprSliders = {};

  const groups = {
    'Eyes':            ['blink', 'blinkLeft', 'blinkRight'],
    'Emotions':        ['happy', 'sad', 'angry', 'surprised', 'relaxed', 'neutral'],
    'Mouth (Vowels)':  ['aa', 'ih', 'ou', 'ee', 'oh'],
  };

  // Collect any expressions not already covered by the groups above
  const allExprs = Object.keys(vrm.expressionManager.expressionMap);
  const knownExprs = new Set(Object.values(groups).flat());
  const extras = allExprs.filter(n => !knownExprs.has(n));
  if (extras.length) groups['Other'] = extras;

  for (const [groupName, names] of Object.entries(groups)) {
    // Only render the group if at least one expression exists on this VRM
    const available = names.filter(n => vrm.expressionManager.expressionMap[n]);
    if (!available.length) continue;

    const label = document.createElement('span');
    label.className = 'vrm-slider-group-label';
    label.textContent = groupName;
    container.appendChild(label);

    for (const name of available) {
      const row = document.createElement('div');
      row.className = 'vrm-expr-row';
      row.innerHTML = `
        <label class="vrm-expr-label" title="${name}">${name}</label>
        <div class="vrm-expr-slider-wrap">
          <input class="vrm-expr-slider" type="range" min="0" max="1" step="0.01" value="0" data-expr="${name}" />
          <span class="vrm-expr-value">0.00</span>
        </div>
      `;
      const inp = row.querySelector('input');
      const out = row.querySelector('.vrm-expr-value');
      inp.addEventListener('input', () => {
        const v = parseFloat(inp.value);
        out.textContent = v.toFixed(2);
        vrm?.expressionManager?.setValue(name, v);
      });
      exprSliders[name] = { input: inp, output: out };
      container.appendChild(row);
    }
  }
}

function resetAllExpressions() {
  for (const [name, { input, output }] of Object.entries(exprSliders)) {
    input.value = 0;
    output.textContent = '0.00';
    vrm?.expressionManager?.setValue(name, 0);
  }
}

// ─── Meta Panel ───────────────────────────────────────────────────────────────

function populateMetaPanel() {
  const panel = document.getElementById('vrm-meta-panel');
  if (!panel || !vrm?.meta) return;
  const m = vrm.meta;
  // VRM 0.x stores author in m.author, 1.x stores an array in m.authors
  const authorVal = m.authors ? m.authors.join(', ') : (m.author || '—');
  const fields = [
    ['Title',   m.name || m.title || '—'],
    ['Author',  authorVal],
    ['Version', m.specVersion || m.version || '—'],
    ['License', m.licenseName || (m.licenseUrl ? 'See URL' : '—')],
    ['Contact', m.contactInformation || '—'],
  ];
  panel.innerHTML = fields.map(([k, v]) => `
    <div class="vrm-meta-item">
      <span class="vrm-meta-key">${k}</span>
      <span class="vrm-meta-val">${escapeHtml(String(v))}</span>
    </div>
  `).join('');
}

function escapeHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── T-Pose ───────────────────────────────────────────────────────────────────

function resetTPose() {
  if (!vrm?.humanoid) return;
  stopActiveVrmAnimation();
  Object.values(VRMHumanBoneName).forEach(boneName => {
    const node = vrm.humanoid.getRawBoneNode(boneName);
    if (node) {
      node.quaternion.identity();
    }
  });
  resetAllExpressions();
}

// ─── Camera Presets ───────────────────────────────────────────────────────────

const CAM_PRESETS = {
  front:   { pos: [0, 1.4, 3],   target: [0, 1.0, 0] },
  side:    { pos: [3, 1.4, 0],   target: [0, 1.0, 0] },
  top:     { pos: [0, 4.5, 0.1], target: [0, 1.0, 0] },
  quarter: { pos: [2, 1.8, 2.2], target: [0, 1.0, 0] },
};

function setCameraPreset(name) {
  const p = CAM_PRESETS[name];
  if (!p || !camera || !controls) return;

  const startPos    = camera.position.clone();
  const startTarget = controls.target.clone();
  const endPos      = new THREE.Vector3(...p.pos);
  const endTarget   = new THREE.Vector3(...p.target);
  let t = 0;

  function animStep() {
    t += 0.05;
    if (t >= 1) t = 1;
    camera.position.lerpVectors(startPos, endPos, easeOut(t));
    controls.target.lerpVectors(startTarget, endTarget, easeOut(t));
    controls.update();
    if (t < 1) requestAnimationFrame(animStep);
  }
  animStep();
}

function easeOut(t) {
  return 1 - Math.pow(1 - t, 3);
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

function takeSnapshot() {
  if (!renderer) return;
  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL('image/png');
  const a = document.createElement('a');
  a.href = url;
  a.download = `vrm-snapshot-${Date.now()}.png`;
  a.click();
}

// ─── Spring Bone Physics ──────────────────────────────────────────────────────

function toggleSpringPhysics(enabled) {
  springEnabled = enabled;
  // Spring updates are controlled via the springEnabled flag checked in the render
  // loop — vrm.update() handles expressions and spring bones together. We expose
  // the flag so applyShakeImpulse can also guard itself.
}

function applyShakeImpulse() {
  if (!vrm?.springBoneManager || !springEnabled) return;
  // Deliver a large time-step to kick spring joints out of equilibrium
  vrm.springBoneManager.update(0.3);
}

// ─── Wind ────────────────────────────────────────────────────────────────────

function applyWind(x, y, z) {
  if (!vrm?.springBoneManager) return;
  try {
    vrm.springBoneManager.joints?.forEach(joint => {
      if (joint.settings) {
        // Blend wind direction with downward gravity
        joint.settings.gravityDir = new THREE.Vector3(x, y - 1, z).normalize();
      }
    });
  } catch (_) {
    // Spring bone API differences across VRM versions — fail silently
  }
}

// ─── Live Capture (MediaPipe Holistic) ───────────────────────────────────────

function newCaptureVideo() {
  const v = document.createElement('video');
  v.autoplay = true;
  v.playsInline = true;
  v.muted = true;
  // Attach in-viewport but invisible. A muted, video-only element that isn't
  // visible gets power-paused by the browser ("video-only background media
  // paused to save power"), which would stall a file-driven capture. Keeping it
  // in the layout (geometry visible, opacity 0) avoids that.
  v.style.cssText = 'position:fixed;right:0;bottom:0;width:8px;height:8px;opacity:0;pointer-events:none;z-index:-1';
  document.body.appendChild(v);
  return v;
}

// Shared MediaPipe Holistic setup + per-frame send loop. The frame source is
// whatever `captureVideo` is — a webcam stream or a playing video file — so the
// same pipeline (Holistic → Kalidokit → VRM bones) drives both.
async function beginCapture() {
  stopActiveVrmAnimation();
  captureActive = true;
  updateCaptureStatusUI(true);

  // Use the global Holistic loaded by index.html's script tag
  if (!holisticInstance && typeof Holistic !== 'undefined') {
    // eslint-disable-next-line no-undef
    holisticInstance = new Holistic({
      locateFile: f => `/mediapipe/holistic/${f}`,
    });
    holisticInstance.setOptions({
      modelComplexity: 1,
      smoothLandmarks: true,
      refineFaceLandmarks: true,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    holisticInstance.onResults(onHolisticResults);
    await holisticInstance.initialize();
  }

  async function sendFrame() {
    if (!captureActive) return;
    if (holisticInstance && captureVideo && captureVideo.readyState >= 2) {
      await holisticInstance.send({ image: captureVideo });
    }
    requestAnimationFrame(sendFrame);
  }
  sendFrame();
}

async function startLiveCapture() {
  if (captureActive) return;
  if (!vrm) { showError('Load a VRM model first.'); return; }

  captureVideo = newCaptureVideo();
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
    captureVideo.srcObject = cameraStream;
    await captureVideo.play();
  } catch (e) {
    showError('Camera access denied: ' + e.message);
    cleanupCaptureVideo();
    return;
  }
  await beginCapture();
}

// Drive the avatar from a video file instead of the webcam. Loops so the
// motion repeats; the source video plays off-screen (only the avatar is shown).
async function startVideoCapture(file) {
  if (!vrm) { showError('Load a VRM model first.'); return; }
  if (captureActive) stopLiveCapture();

  captureVideo = newCaptureVideo();
  captureObjectUrl = URL.createObjectURL(file);
  captureVideo.src = captureObjectUrl;
  captureVideo.loop = true;
  try {
    await captureVideo.play();
  } catch (e) {
    showError('Could not play that video: ' + e.message);
    cleanupCaptureVideo();
    return;
  }
  await beginCapture();
}

function cleanupCaptureVideo() {
  if (captureVideo) {
    try { captureVideo.pause(); } catch (_) { /* ignore */ }
    captureVideo.remove();
  }
  if (captureObjectUrl) { URL.revokeObjectURL(captureObjectUrl); captureObjectUrl = null; }
  captureVideo = null;
}

function stopLiveCapture() {
  captureActive = false;
  if (recording) stopRecording();
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  cleanupCaptureVideo();
  updateCaptureStatusUI(false);
}

function onHolisticResults(results) {
  if (!vrm || !captureActive) return;
  applyHolisticToVrm(vrm, results);
  if (recording) recordFrame();
}

// ─── Kalidokit → VRM Rigging ─────────────────────────────────────────────────

function applyHolisticToVrm(targetVrm, results) {
  if (!KFace || !KPose) return;

  // Face
  if (results.faceLandmarks?.length) {
    try {
      const face = KFace.solve(results.faceLandmarks, {
        runtime: 'mediapipe',
        video: captureVideo,
      });
      if (face) {
        rigRotation(targetVrm, 'Neck', {
          x: (face.head?.x ?? 0) * 0.5,
          y: (face.head?.y ?? 0) * 0.5,
          z: (face.head?.z ?? 0) * 0.5,
        });
        rigRotation(targetVrm, 'Head', {
          x: (face.head?.x ?? 0) * 0.5,
          y: (face.head?.y ?? 0) * 0.5,
          z: (face.head?.z ?? 0) * 0.5,
        });
        if (targetVrm.expressionManager) {
          const em = targetVrm.expressionManager;
          const blink = 1 - (face.eye?.l ?? 1);
          em.setValue('blink',      Math.max(0, Math.min(1, blink)));
          em.setValue('blinkLeft',  Math.max(0, Math.min(1, 1 - (face.eye?.l ?? 1))));
          em.setValue('blinkRight', Math.max(0, Math.min(1, 1 - (face.eye?.r ?? 1))));
          // Sync sliders if they exist
          syncExprSlider('blink',      blink);
          syncExprSlider('blinkLeft',  1 - (face.eye?.l ?? 1));
          syncExprSlider('blinkRight', 1 - (face.eye?.r ?? 1));
        }
      }
    } catch (_) { /* non-fatal */ }
  }

  // Body
  if (results.poseLandmarks?.length) {
    try {
      const worldLandmarks = results.poseWorldLandmarks ?? results.poseLandmarks;
      const pose = KPose.solve(worldLandmarks, results.poseLandmarks, {
        runtime: 'mediapipe',
        video: captureVideo,
      });
      if (pose) {
        if (pose.Hips?.rotation) rigRotation(targetVrm, 'Hips', pose.Hips.rotation, 0.7);
        if (pose.Spine)          rigRotation(targetVrm, 'Chest', pose.Spine, 0.25, 0.3);
        if (pose.Spine)          rigRotation(targetVrm, 'Spine',  pose.Spine, 0.45, 0.3);
        if (pose.RightUpperArm)  rigRotation(targetVrm, 'RightUpperArm', pose.RightUpperArm, 1, 0.3);
        if (pose.RightLowerArm)  rigRotation(targetVrm, 'RightLowerArm', pose.RightLowerArm, 1, 0.3);
        if (pose.LeftUpperArm)   rigRotation(targetVrm, 'LeftUpperArm',  pose.LeftUpperArm,  1, 0.3);
        if (pose.LeftLowerArm)   rigRotation(targetVrm, 'LeftLowerArm',  pose.LeftLowerArm,  1, 0.3);
      }
    } catch (_) { /* non-fatal */ }
  }

  // Hands
  if (KHand) {
    if (results.leftHandLandmarks?.length) {
      try {
        const rigLeft = KHand.solve(results.leftHandLandmarks, 'Left');
        if (rigLeft?.LeftWrist) rigRotation(targetVrm, 'LeftHand', rigLeft.LeftWrist, 1, 0.3);
      } catch (_) { /* non-fatal */ }
    }
    if (results.rightHandLandmarks?.length) {
      try {
        const rigRight = KHand.solve(results.rightHandLandmarks, 'Right');
        if (rigRight?.RightWrist) rigRotation(targetVrm, 'RightHand', rigRight.RightWrist, 1, 0.3);
      } catch (_) { /* non-fatal */ }
    }
  }
}

/**
 * Apply a Kalidokit rotation result to a VRM humanoid bone via slerp.
 */
function rigRotation(targetVrm, name, rotation, dampener = 1, lerp = 0.3) {
  const boneName = VRMHumanBoneName[name];
  if (!boneName) return;
  const node = targetVrm.humanoid?.getRawBoneNode(boneName);
  if (!node) return;
  const euler = new THREE.Euler(
    (rotation.x ?? 0) * dampener,
    (rotation.y ?? 0) * dampener,
    (rotation.z ?? 0) * dampener,
  );
  node.quaternion.slerp(new THREE.Quaternion().setFromEuler(euler), lerp);
}

/** Keep the UI slider in sync when live capture drives an expression. */
function syncExprSlider(name, value) {
  const s = exprSliders[name];
  if (!s) return;
  const v = Math.max(0, Math.min(1, value));
  s.input.value = v;
  s.output.textContent = v.toFixed(2);
}

// ─── Motion Record / Replay ──────────────────────────────────────────────────

function recordFrame() {
  if (!vrm) return;
  const bones = {};
  for (const name of RECORDED_BONES) {
    const node = vrm.humanoid?.getRawBoneNode(VRMHumanBoneName[name]);
    if (node) { const q = node.quaternion; bones[name] = [q.x, q.y, q.z, q.w]; }
  }
  const expr = {};
  if (vrm.expressionManager) {
    for (const e of RECORDED_EXPR) expr[e] = vrm.expressionManager.getValue(e) ?? 0;
  }
  recordedFrames.push({ t: performance.now() - recordStartTime, bones, expr });
  if (recordedFrames.length % 10 === 0) updateRecordUI();
}

function startRecording() {
  if (!captureActive) { showError('Start capture (webcam or video) first, then record.'); return; }
  recordedFrames = [];
  recordStartTime = performance.now();
  recording = true;
  updateRecordUI();
}

function stopRecording() {
  recording = false;
  updateRecordUI();
}

function startReplay() {
  if (!recordedFrames.length) { showError('Record a performance first.'); return; }
  if (!vrm) { showError('Load a VRM model first.'); return; }
  if (captureActive) stopLiveCapture();
  stopActiveVrmAnimation();
  playingRecording = true;
  replayStartTime = performance.now();
  updateRecordUI();
}

function stopReplay() {
  playingRecording = false;
  updateRecordUI();
}

// Interpolate the recorded bone rotations + expressions for the looped playhead.
function applyRecordedPose(tMs) {
  const n = recordedFrames.length;
  if (!n || !vrm) return;
  const dur = recordedFrames[n - 1].t;
  const t = dur > 0 ? (tMs % dur) : 0;
  let i = 1;
  while (i < n && recordedFrames[i].t < t) i++;
  const f0 = recordedFrames[i - 1];
  const f1 = recordedFrames[Math.min(i, n - 1)];
  const span = (f1.t - f0.t) || 1;
  const a = Math.max(0, Math.min(1, (t - f0.t) / span));
  for (const name of RECORDED_BONES) {
    const q0 = f0.bones[name];
    if (!q0) continue;
    const q1 = f1.bones[name] || q0;
    const node = vrm.humanoid?.getRawBoneNode(VRMHumanBoneName[name]);
    if (!node) continue;
    _qa.set(q0[0], q0[1], q0[2], q0[3]);
    _qb.set(q1[0], q1[1], q1[2], q1[3]);
    node.quaternion.copy(_qa).slerp(_qb, a);
  }
  if (vrm.expressionManager && f0.expr) {
    for (const e of RECORDED_EXPR) {
      const v0 = f0.expr[e] ?? 0;
      const v1 = f1.expr?.[e] ?? v0;
      const v = v0 + (v1 - v0) * a;
      vrm.expressionManager.setValue(e, v);
      syncExprSlider(e, v);
    }
  }
}

function exportMotion() {
  if (!recordedFrames.length) { showError('Nothing recorded yet.'); return; }
  const data = {
    type: 'vrm-motion', version: 1,
    duration: recordedFrames[recordedFrames.length - 1].t,
    frameCount: recordedFrames.length,
    bones: RECORDED_BONES, expressions: RECORDED_EXPR,
    frames: recordedFrames,
  };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'vrm-motion.json';
  a.click();
  URL.revokeObjectURL(url);
}

async function loadMotion(file) {
  try {
    const data = JSON.parse(await file.text());
    if (data?.type !== 'vrm-motion' || !Array.isArray(data.frames) || !data.frames.length) {
      throw new Error('Not a VRM motion file.');
    }
    recordedFrames = data.frames;
    updateRecordUI();
  } catch (e) {
    showError('Could not load motion: ' + e.message);
  }
}

function attachLookAtProxy(targetVrm) {
  if (!targetVrm?.lookAt || targetVrm.scene.getObjectByName('lookAtQuaternionProxy')) return;
  const proxy = new VRMLookAtQuaternionProxy(targetVrm.lookAt);
  proxy.name = 'lookAtQuaternionProxy';
  targetVrm.scene.add(proxy);
}

function captureAnimationBaseState() {
  activeAnimationBasePose = vrm?.humanoid?.getNormalizedPose?.() ?? null;
  activeAnimationBaseExpressions = null;
  if (vrm?.expressionManager) {
    activeAnimationBaseExpressions = {};
    Object.keys(vrm.expressionManager.expressionMap).forEach(name => {
      activeAnimationBaseExpressions[name] = vrm.expressionManager.getValue(name) ?? 0;
    });
  }
  activeAnimationBaseLookAt = vrm?.lookAt ? {
    yaw: vrm.lookAt.yaw,
    pitch: vrm.lookAt.pitch,
    autoUpdate: vrm.lookAt.autoUpdate,
  } : null;
}

function restoreAnimationBaseState() {
  if (activeAnimationBasePose && vrm?.humanoid) {
    vrm.humanoid.setNormalizedPose(activeAnimationBasePose);
  } else {
    vrm?.humanoid?.resetNormalizedPose?.();
  }

  if (activeAnimationBaseExpressions && vrm?.expressionManager) {
    Object.entries(activeAnimationBaseExpressions).forEach(([name, value]) => {
      vrm.expressionManager.setValue(name, value);
      syncExprSlider(name, value);
    });
  }

  if (activeAnimationBaseLookAt && vrm?.lookAt) {
    vrm.lookAt.yaw = activeAnimationBaseLookAt.yaw;
    vrm.lookAt.pitch = activeAnimationBaseLookAt.pitch;
    vrm.lookAt.autoUpdate = activeAnimationBaseLookAt.autoUpdate;
  }
}

async function parseVrmAnimationBuffer(buffer) {
  if (looksLikeHtml(buffer)) {
    throw new Error('That URL returned a page, not a .vrma animation file.');
  }
  const loader = new GLTFLoader();
  loader.register(parser => new VRMAnimationLoaderPlugin(parser));
  const gltf = await loader.parseAsync(buffer, '');
  const vrmAnimation = gltf.userData.vrmAnimations?.[0];
  if (!vrmAnimation) throw new Error('That file does not contain a VRM Animation clip.');
  return vrmAnimation;
}

async function loadVrmAnimationFromUrl(preset) {
  if (vrmAnimationCache.has(preset.id)) return vrmAnimationCache.get(preset.id);
  const resp = await fetch(preset.url);
  if (!resp.ok) {
    throw new Error(`${preset.label} is not downloaded yet. Expected ${preset.url}`);
  }
  const buffer = await resp.arrayBuffer();
  if (looksLikeHtml(buffer)) {
    throw new Error(`${preset.label} is not downloaded yet. Expected ${preset.url}`);
  }
  const vrmAnimation = await parseVrmAnimationBuffer(buffer);
  vrmAnimationCache.set(preset.id, vrmAnimation);
  return vrmAnimation;
}

async function playLoadedVrmAnimation(vrmAnimation, id, label) {
  if (!vrm) {
    showError('Load a VRM model first.');
    updateAnimationStatus('Load a VRM first');
    return;
  }
  if (captureActive) stopLiveCapture();
  if (playingRecording) stopReplay();

  stopActiveVrmAnimation();
  captureAnimationBaseState();

  try {
    attachLookAtProxy(vrm);
    const clip = createVRMAnimationClip(vrmAnimation, vrm);
    vrmAnimationMixer = new THREE.AnimationMixer(vrm.scene);
    vrmAnimationAction = vrmAnimationMixer.clipAction(clip);
    vrmAnimationAction.reset().play();
    if (vrm.lookAt) {
      vrm.lookAt.reset();
      vrm.lookAt.autoUpdate = vrmAnimation.lookAtTrack != null;
    }
    activeAnimationId = id;
    updateAnimationStatus(`${label} · playing`);
    updateAnimationControls();
  } catch (err) {
    stopActiveVrmAnimation();
    throw err;
  }
}

function stopActiveVrmAnimation() {
  if (vrmAnimationAction) vrmAnimationAction.stop();
  vrmAnimationMixer?.stopAllAction();
  vrmAnimationAction = null;
  vrmAnimationMixer = null;
  activeAnimationId = null;
  restoreAnimationBaseState();
  activeAnimationBasePose = null;
  activeAnimationBaseExpressions = null;
  activeAnimationBaseLookAt = null;
  updateAnimationControls(true);
}

function updateAnimationStatus(text) {
  const status = document.getElementById('vrm-animation-status');
  if (status) status.textContent = text;
}

function renderAnimationButtons() {
  const results = document.getElementById('vrm-animation-results');
  const search = document.getElementById('vrm-animation-search');
  if (!results) return;

  const query = (search?.value || '').trim().toLowerCase();
  const matches = ANIMATION_PRESETS.filter(anim => {
    const haystack = `${anim.label} ${anim.keywords}`.toLowerCase();
    return !query || haystack.includes(query);
  });

  if (!matches.length) {
    results.innerHTML = '<p class="vrm-animation-empty">No matches</p>';
    return;
  }

  results.innerHTML = matches.map(anim => `
    <button
      class="vrm-animation-chip"
      type="button"
      data-animation-id="${escapeHtml(anim.id)}"
      aria-pressed="${activeAnimationId === anim.id ? 'true' : 'false'}"
    >${escapeHtml(anim.label)}</button>
  `).join('');
  updateAnimationControls();
}

async function playAnimationPreset(id) {
  const preset = ANIMATION_PRESETS.find(anim => anim.id === id);
  if (!preset) return;
  updateAnimationStatus(`${preset.label} · loading`);
  try {
    const vrmAnimation = await loadVrmAnimationFromUrl(preset);
    await playLoadedVrmAnimation(vrmAnimation, preset.id, preset.label);
  } catch (err) {
    console.warn('[VRM Editor] animation unavailable:', err);
    updateAnimationStatus(err.message);
    showError(`Could not play ${preset.label}: ${err.message}`);
    updateAnimationControls(false);
  }
}

async function playVrmAnimationFile(file) {
  updateAnimationStatus(`${file.name} · loading`);
  try {
    const vrmAnimation = await parseVrmAnimationBuffer(await file.arrayBuffer());
    const label = file.name.replace(/\.vrma$/i, '');
    await playLoadedVrmAnimation(vrmAnimation, `file:${file.name}`, label);
  } catch (err) {
    console.warn('[VRM Editor] animation file unavailable:', err);
    updateAnimationStatus(err.message);
    showError(`Could not play ${file.name}: ${err.message}`);
    updateAnimationControls(false);
  }
}

function initAnimationPanel() {
  renderAnimationButtons();
  document.getElementById('vrm-animation-search')
    ?.addEventListener('input', renderAnimationButtons);
  document.getElementById('vrm-animation-results')
    ?.addEventListener('click', event => {
      const btn = event.target.closest('[data-animation-id]');
      if (!btn) return;
      playAnimationPreset(btn.dataset.animationId);
    });
  document.getElementById('vrm-stop-animation-btn')
    ?.addEventListener('click', stopActiveVrmAnimation);
  document.getElementById('vrm-import-vrma-btn')
    ?.addEventListener('click', () => document.getElementById('vrm-vrma-input')?.click());
  document.getElementById('vrm-vrma-input')
    ?.addEventListener('change', async event => {
      const file = event.target.files?.[0];
      if (file) await playVrmAnimationFile(file);
      event.target.value = '';
    });
}

function updateAnimationControls(resetStatus = false) {
  const playing = Boolean(vrmAnimationMixer);
  const stopBtn = document.getElementById('vrm-stop-animation-btn');
  if (stopBtn) stopBtn.disabled = !playing;
  document.querySelectorAll('[data-animation-id]').forEach(btn => {
    const active = activeAnimationId === btn.dataset.animationId;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-pressed', String(active));
  });
  if (!playing && resetStatus) updateAnimationStatus('No animation playing');
}

function updateRecordUI() {
  const recBtn = document.getElementById('vrm-record-btn');
  const playBtn = document.getElementById('vrm-replay-btn');
  const exportBtn = document.getElementById('vrm-export-motion-btn');
  const status = document.getElementById('vrm-record-status');
  if (recBtn) recBtn.textContent = recording ? '⏹ Stop Recording' : '⏺ Record';
  if (playBtn) {
    playBtn.textContent = playingRecording ? '⏹ Stop Replay' : '▶ Replay';
    playBtn.disabled = !recordedFrames.length && !playingRecording;
  }
  if (exportBtn) exportBtn.disabled = !recordedFrames.length;
  if (status) {
    if (recording) {
      status.textContent = `Recording… ${recordedFrames.length} frames`;
    } else if (recordedFrames.length) {
      const dur = (recordedFrames[recordedFrames.length - 1].t / 1000).toFixed(1);
      status.textContent = `${recordedFrames.length} frames · ${dur}s${playingRecording ? ' · replaying' : ''}`;
    } else {
      status.textContent = 'No recording yet';
    }
  }
}

// ─── Drag and Drop ───────────────────────────────────────────────────────────

function setupDragDrop(viewportEl) {
  viewportEl.addEventListener('dragover', e => {
    e.preventDefault();
    document.getElementById('vrm-drop-zone')?.classList.add('drag-over');
  });
  viewportEl.addEventListener('dragleave', () => {
    document.getElementById('vrm-drop-zone')?.classList.remove('drag-over');
  });
  viewportEl.addEventListener('drop', async e => {
    e.preventDefault();
    document.getElementById('vrm-drop-zone')?.classList.remove('drag-over');
    const file = e.dataTransfer?.files[0];
    if (file && (file.name.endsWith('.vrm') || file.name.endsWith('.glb'))) {
      await loadVrmFile(file);
    }
  });
}

// ─── Collapsible Panel Sections ──────────────────────────────────────────────

function initCollapsibleSections() {
  document.querySelectorAll('.vrm-panel-section-header').forEach(header => {
    header.setAttribute('role', 'button');
    header.setAttribute('tabindex', '0');
    header.setAttribute('aria-expanded', 'true');

    const toggle = () => {
      const section = header.closest('.vrm-panel-section');
      if (!section) return;
      const collapsed = section.classList.toggle('collapsed');
      header.setAttribute('aria-expanded', String(!collapsed));
    };

    header.addEventListener('click', toggle);
    header.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      toggle();
    });
  });
}

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function showDropZone() {
  const el = document.getElementById('vrm-drop-zone');
  if (el) el.hidden = false;
}

function hideDropZone() {
  const el = document.getElementById('vrm-drop-zone');
  if (el) el.hidden = true;
}

function updateFilenamePill(name) {
  const el = document.getElementById('vrm-filename');
  if (el) el.textContent = name;
}

function showLoadingState(loading) {
  const el = document.getElementById('vrm-loading');
  if (el) el.hidden = !loading;
}

function showError(msg) {
  const el = document.getElementById('vrm-error-msg');
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  setTimeout(() => { el.hidden = true; }, 4000);
}

function updateCaptureStatusUI(active) {
  const status = document.getElementById('vrm-capture-status');
  const btn    = document.getElementById('vrm-capture-btn');
  if (status) status.classList.toggle('active', active);
  if (btn)    btn.textContent = active ? 'Stop Capture' : 'Start Live Capture';
}

// ─── Export Modal ─────────────────────────────────────────────────────────────

function showExportModal() {
  const backdrop = document.getElementById('vrm-export-modal');
  if (backdrop) backdrop.hidden = false;
}

function hideExportModal() {
  const backdrop = document.getElementById('vrm-export-modal');
  if (backdrop) backdrop.hidden = true;
}

function openMotionLibrary() {
  navigate('motion-capture');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.getElementById('motion-library-card')?.scrollIntoView({
        block: 'center',
        behavior: 'smooth',
      });
      document.getElementById('motionSearchQuery')?.focus({ preventScroll: true });
    });
  });
}

// ─── Public Entry Point ───────────────────────────────────────────────────────

export function initVrmEditor() {
  const viewEl = document.getElementById('view-vrm-editor');
  if (!viewEl) return;

  const viewportEl = document.getElementById('vrm-viewport');
  if (!viewportEl) {
    console.error('[VRM Editor] #vrm-viewport not found');
    return;
  }

  setupThree(viewportEl);
  setupDragDrop(viewportEl);
  initCollapsibleSections();

  // Resize observer — re-fit renderer when the viewport changes size
  new ResizeObserver(handleResize).observe(viewportEl);

  // Mutation observer on the view's `hidden` attribute
  // → start render loop when the view becomes visible, stop it when hidden
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.attributeName === 'hidden') {
        if (!viewEl.hidden) {
          startRenderLoop();
        } else {
          stopRenderLoop();
          stopLiveCapture();
        }
      }
    }
  }).observe(viewEl, { attributes: true });

  // ── Button: back to home ──────────────────────────────────────────────────
  document.getElementById('vrm-back-btn')
    ?.addEventListener('click', () => navigate('home'));

  // ── Button: jump to saved/processed motion clips ──────────────────────────
  document.getElementById('vrm-open-motion-library')
    ?.addEventListener('click', openMotionLibrary);

  // ── Button / file input: open file ───────────────────────────────────────
  const fileInput = document.getElementById('vrm-file-input');
  fileInput?.addEventListener('change', async e => {
    const f = e.target.files?.[0];
    if (f) {
      await loadVrmFile(f);
      // Reset input so the same file can be re-selected
      fileInput.value = '';
    }
  });

  // Clicking the drop-zone label opens the hidden file input
  document.getElementById('vrm-file-drop-label')
    ?.addEventListener('click', () => fileInput?.click());

  // ── Button: load default VRM ──────────────────────────────────────────────
  document.getElementById('vrm-load-default')
    ?.addEventListener('click', () => {
      loadVrmFromUrl('/vrm/default.vrm', 'default.vrm');
    });

  // ── Button: reset all expressions ────────────────────────────────────────
  document.getElementById('vrm-expr-reset')
    ?.addEventListener('click', resetAllExpressions);

  // ── Button: T-Pose ───────────────────────────────────────────────────────
  document.getElementById('vrm-tpose-btn')
    ?.addEventListener('click', resetTPose);

  // ── Floating animation panel ────────────────────────────────────────────
  initAnimationPanel();

  // ── Button: snapshot ─────────────────────────────────────────────────────
  document.getElementById('vrm-snapshot-btn')
    ?.addEventListener('click', takeSnapshot);

  // ── Export modal ─────────────────────────────────────────────────────────
  document.getElementById('vrm-export-btn')
    ?.addEventListener('click', showExportModal);
  document.getElementById('vrm-modal-close')
    ?.addEventListener('click', hideExportModal);
  document.getElementById('vrm-export-modal')
    ?.addEventListener('click', e => {
      if (e.target === e.currentTarget) hideExportModal();
    });

  // ── Live capture ─────────────────────────────────────────────────────────
  document.getElementById('vrm-capture-btn')
    ?.addEventListener('click', () => {
      if (!captureActive) startLiveCapture();
      else stopLiveCapture();
    });

  // ── Drive from a video file ──────────────────────────────────────────────
  const captureVideoInput = document.getElementById('vrm-capture-video-input');
  document.getElementById('vrm-capture-video-btn')
    ?.addEventListener('click', () => captureVideoInput?.click());
  captureVideoInput?.addEventListener('change', () => {
    const f = captureVideoInput.files?.[0];
    if (f) startVideoCapture(f);
    captureVideoInput.value = '';
  });

  // ── Motion record / replay / export / load ───────────────────────────────
  document.getElementById('vrm-record-btn')
    ?.addEventListener('click', () => { recording ? stopRecording() : startRecording(); });
  document.getElementById('vrm-replay-btn')
    ?.addEventListener('click', () => { playingRecording ? stopReplay() : startReplay(); });
  document.getElementById('vrm-export-motion-btn')
    ?.addEventListener('click', exportMotion);
  const motionInput = document.getElementById('vrm-motion-input');
  document.getElementById('vrm-load-motion-btn')
    ?.addEventListener('click', () => motionInput?.click());
  motionInput?.addEventListener('change', () => {
    const f = motionInput.files?.[0];
    if (f) loadMotion(f);
    motionInput.value = '';
  });
  updateRecordUI();

  // ── Camera presets ───────────────────────────────────────────────────────
  ['front', 'side', 'top', 'quarter'].forEach(name => {
    document.getElementById(`vrm-cam-${name}`)
      ?.addEventListener('click', () => {
        setCameraPreset(name);
        // Mark active button
        document.querySelectorAll('.vrm-cam-btn').forEach(b => b.classList.remove('active'));
        document.getElementById(`vrm-cam-${name}`)?.classList.add('active');
      });
  });

  // ── Spring physics toggle ─────────────────────────────────────────────────
  document.getElementById('vrm-spring-toggle')
    ?.addEventListener('change', e => {
      springEnabled = e.target.checked;
      toggleSpringPhysics(springEnabled);
    });

  // ── Shake impulse ────────────────────────────────────────────────────────
  document.getElementById('vrm-shake-btn')
    ?.addEventListener('click', applyShakeImpulse);

  // ── Wind sliders ─────────────────────────────────────────────────────────
  ['x', 'y', 'z'].forEach(axis => {
    const slider = document.getElementById(`vrm-wind-${axis}`);
    // Each wind slider row's value readout is the next sibling .vrm-expr-value
    const readout = slider?.closest('.vrm-expr-row')?.querySelector('.vrm-expr-value');
    slider?.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      if (readout) readout.textContent = v.toFixed(2);
      const x = parseFloat(document.getElementById('vrm-wind-x')?.value ?? '0');
      const y = parseFloat(document.getElementById('vrm-wind-y')?.value ?? '0');
      const z = parseFloat(document.getElementById('vrm-wind-z')?.value ?? '0');
      applyWind(x, y, z);
    });
  });

  // ── If the view is already visible on init, start the render loop ─────────
  if (!viewEl.hidden) startRenderLoop();
}
