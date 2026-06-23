import "./styles.css";
import { MushyAvatar } from "./avatar.js";
import { ModelGallery } from "./modelGallery.js";

const videoElement = document.createElement("video");
videoElement.setAttribute("playsinline", "");
videoElement.preload = "metadata";

const imageElement = new Image();
imageElement.decoding = "async";

const canvasElement = document.getElementById("output");
const canvasCtx = canvasElement.getContext("2d", { alpha: true });
const statusEl = document.getElementById("status");
const sourceSelect = document.getElementById("source");
const videoFileInput = document.getElementById("videoFile");
const modeSelect = document.getElementById("mode");
const visualStyleSelect = document.getElementById("visualStyle");
const overlaySkeletonToggle = document.getElementById("overlaySkeleton");
const loopVideoToggle = document.getElementById("loopVideo");
const bodyTableEl = document.getElementById("bodyTable");
const faceTableEl = document.getElementById("faceTable");
const leftHandTableEl = document.getElementById("leftHandTable");
const rightHandTableEl = document.getElementById("rightHandTable");
const bodySkeletonCanvas = document.getElementById("bodySkeleton");
const faceSkeletonCanvas = document.getElementById("faceSkeleton");
const leftHandSkeletonCanvas = document.getElementById("leftHandSkeleton");
const rightHandSkeletonCanvas = document.getElementById("rightHandSkeleton");
const bodySkeletonCtx = bodySkeletonCanvas.getContext("2d");
const faceSkeletonCtx = faceSkeletonCanvas.getContext("2d");
const leftHandSkeletonCtx = leftHandSkeletonCanvas.getContext("2d");
const rightHandSkeletonCtx = rightHandSkeletonCanvas.getContext("2d");
const copyButton = document.getElementById("copyKeypoints");
const playVideoButton = document.getElementById("playVideo");
const restartVideoButton = document.getElementById("restartVideo");
const snapshotButton = document.getElementById("downloadSnapshot");
const retryButton = document.getElementById("retryCamera");
const restartCameraButton = document.getElementById("restartCamera");
const frameMetaEl = document.getElementById("frameMeta");
const detectionStateEl = document.getElementById("detectionState");
const bodyTrackingMetaEl = document.getElementById("bodyTrackingMeta");
const faceTrackingMetaEl = document.getElementById("faceTrackingMeta");
const leftHandTrackingMetaEl = document.getElementById("leftHandTrackingMeta");
const rightHandTrackingMetaEl = document.getElementById("rightHandTrackingMeta");
const bodyModelGalleryEl = document.getElementById("bodyModelGallery");
const faceModelGalleryEl = document.getElementById("faceModelGallery");
const riggedModelMountEl = document.getElementById("riggedModelMount");
const riggedModelMetaEl = document.getElementById("riggedModelMeta");
const driverNameEl = document.getElementById("driverName");
const driverMetaEl = document.getElementById("driverMeta");
const driverAnimSelectEl = document.getElementById("driverAnimSelect");
const driverExportBtn = document.getElementById("driverExportBtn");
const lastExportTimeEl = document.getElementById("lastExportTime");
const modelsLoadedIndicatorEl = document.getElementById("modelsLoadedIndicator");
const modelsLoadedTextEl = document.getElementById("modelsLoadedText");
const refreshModelsButton = document.getElementById("refreshModels");

let latestResults = null;
let cameraInstance = null;
let glowTrails = [];
let frameTick = 0;
let holistic = null;
let modelGallery = null;
let videoObjectUrl = null;
let imageObjectUrl = null;
let videoLoopId = null;
let cameraLoopId = null;
let autoCameraTimer = null;
let isProcessingFrame = false;
let videoLoaded = false;
let imageLoaded = false;
let currentImageName = "";
let currentMediaRect = null;
let lastExportAt = null;

const BODY_GLOW_PATHS = [
  [15, 13, 11, 12, 14, 16],
  [27, 25, 23, 24, 26, 28],
  [0, 11, 23, 24, 12, 0]
];

const FACE_GLOW_POINTS = [10, 33, 61, 152, 291, 263];
const MEDIAPIPE_HOLISTIC_ASSET_PATH = "/mediapipe/holistic";

const KEY_LANDMARKS = {
  nose: 0,
  left_shoulder: 11,
  right_shoulder: 12,
  left_elbow: 13,
  right_elbow: 14,
  left_wrist: 15,
  right_wrist: 16,
  left_hip: 23,
  right_hip: 24,
  left_knee: 25,
  right_knee: 26,
  left_ankle: 27,
  right_ankle: 28
};

const FACE_LANDMARKS = {
  nose_tip: 1,
  left_eye_outer: 33,
  left_eye_inner: 133,
  right_eye_inner: 362,
  right_eye_outer: 263,
  mouth_left: 61,
  mouth_right: 291,
  upper_lip: 13,
  lower_lip: 14,
  chin: 152
};

const HAND_LANDMARKS = {
  wrist: 0,
  thumb_tip: 4,
  index_tip: 8,
  middle_tip: 12,
  ring_tip: 16,
  pinky_tip: 20
};

function hasMediaPipeGlobals() {
  return Boolean(
    window.Holistic &&
      window.drawConnectors &&
      window.drawLandmarks
  );
}

function setStatus(message, tone = "success") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function setDetectionState(message) {
  detectionStateEl.textContent = message;
}

function getSourceLabel() {
  if (sourceSelect.value === "video") return "video file";
  if (sourceSelect.value === "image") return "image file";
  return "webcam feed";
}

function resizeCanvasToDisplay(canvas) {
  const rect = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width || canvas.clientWidth || canvas.width));
  const height = Math.max(1, Math.round(rect.height || canvas.clientHeight || canvas.height));

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function resizeOutputCanvasToDisplay() {
  resizeCanvasToDisplay(canvasElement);
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

function projectLandmarkToCanvas(landmark) {
  const rect = currentMediaRect || {
    x: 0,
    y: 0,
    width: canvasElement.width,
    height: canvasElement.height
  };

  return {
    ...landmark,
    x: (rect.x + landmark.x * rect.width) / canvasElement.width,
    y: (rect.y + landmark.y * rect.height) / canvasElement.height
  };
}

function projectLandmarksToCanvas(landmarks) {
  return landmarks?.map((landmark) => (landmark ? projectLandmarkToCanvas(landmark) : landmark));
}

function toCanvasPoint(landmark) {
  const rect = currentMediaRect || {
    x: 0,
    y: 0,
    width: canvasElement.width,
    height: canvasElement.height
  };
  return {
    x: rect.x + landmark.x * rect.width,
    y: rect.y + landmark.y * rect.height
  };
}

function addGlowTrail(points, type = "body") {
  if (!points || points.length < 2) return;

  glowTrails.push({
    points,
    age: 0,
    life: type === "face" ? 16 : 26,
    hue: (frameTick * 9 + Math.random() * 70) % 360,
    width: type === "face" ? 1.8 : 3.6
  });

  if (glowTrails.length > 64) {
    glowTrails.splice(0, glowTrails.length - 64);
  }
}

function collectGlowTrails(mode) {
  if (mode !== "face" && latestResults?.poseLandmarks) {
    const landmarks = latestResults.poseLandmarks;
    const visible = (index) => landmarks[index] && (landmarks[index].visibility ?? 1) > 0.45;

    BODY_GLOW_PATHS.forEach((path) => {
      const points = path.filter(visible).map((index) => toCanvasPoint(landmarks[index]));
      addGlowTrail(points, "body");
    });
  }

  if (mode !== "body" && latestResults?.faceLandmarks) {
    const face = latestResults.faceLandmarks;
    const points = FACE_GLOW_POINTS.filter((index) => face[index]).map((index) =>
      toCanvasPoint(face[index])
    );
    addGlowTrail(points, "face");
  }
}

function drawNeonPolyline(points, hue, alpha, width) {
  if (!points || points.length < 2) return;

  canvasCtx.beginPath();
  canvasCtx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length - 1; i += 1) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    canvasCtx.quadraticCurveTo(points[i].x, points[i].y, midX, midY);
  }

  const last = points[points.length - 1];
  canvasCtx.lineTo(last.x, last.y);

  canvasCtx.lineCap = "round";
  canvasCtx.lineJoin = "round";
  canvasCtx.globalCompositeOperation = "lighter";

  canvasCtx.shadowColor = `hsla(${hue}, 100%, 65%, ${alpha})`;
  canvasCtx.shadowBlur = 16;
  canvasCtx.strokeStyle = `hsla(${hue}, 100%, 62%, ${alpha * 0.28})`;
  canvasCtx.lineWidth = width * 3;
  canvasCtx.stroke();

  canvasCtx.shadowBlur = 8;
  canvasCtx.strokeStyle = `hsla(${(hue + 42) % 360}, 100%, 68%, ${alpha * 0.55})`;
  canvasCtx.lineWidth = width * 1.35;
  canvasCtx.stroke();

  canvasCtx.shadowBlur = 0;
  canvasCtx.strokeStyle = `rgba(255,255,255,${alpha})`;
  canvasCtx.lineWidth = Math.max(1, width * 0.42);
  canvasCtx.stroke();

  canvasCtx.globalCompositeOperation = "source-over";
}

function drawGlowTrails() {
  glowTrails.forEach((trail) => {
    const alpha = Math.max(0, 1 - trail.age / trail.life);
    drawNeonPolyline(trail.points, trail.hue + trail.age * 4, alpha, trail.width);
    trail.age += 1;
  });

  glowTrails = glowTrails.filter((trail) => trail.age < trail.life);
}

function compactBodyLandmarks(landmarks, rounded = true) {
  const body = {};

  Object.entries(KEY_LANDMARKS).forEach(([name, index]) => {
    if (!landmarks[index]) return;
    const point = landmarks[index];

    body[name] = rounded
      ? {
          x: Number(point.x.toFixed(4)),
          y: Number(point.y.toFixed(4)),
          z: Number((point.z || 0).toFixed(4)),
          visibility: Number((point.visibility || 0).toFixed(3))
        }
      : {
          x: point.x,
          y: point.y,
          z: point.z || 0,
          visibility: point.visibility || 0
        };
  });

  return body;
}

function compactFaceLandmarks(landmarks) {
  const face = {};

  Object.entries(FACE_LANDMARKS).forEach(([name, index]) => {
    if (!landmarks[index]) return;
    const point = landmarks[index];

    face[name] = {
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4)),
      z: Number((point.z || 0).toFixed(4))
    };
  });

  return face;
}

function compactHandLandmarks(landmarks, side) {
  const hand = {};

  Object.entries(HAND_LANDMARKS).forEach(([name, index]) => {
    if (!landmarks?.[index]) return;
    const point = landmarks[index];

    hand[`${side}_${name}`] = {
      x: Number(point.x.toFixed(4)),
      y: Number(point.y.toFixed(4)),
      z: Number((point.z || 0).toFixed(4))
    };
  });

  return hand;
}

function buildCurrentExportData({ fullFace = true } = {}) {
  const mode = modeSelect.value;
  const exportData = {
    timestamp: new Date().toISOString(),
    mode,
    body: null,
    face: null,
    hands: null
  };

  if ((mode === "body" || mode === "both") && latestResults?.poseLandmarks) {
    exportData.body = compactBodyLandmarks(latestResults.poseLandmarks, !fullFace);
  }

  if ((mode === "face" || mode === "both") && latestResults?.faceLandmarks) {
    const landmarks = latestResults.faceLandmarks;
    exportData.face = fullFace
      ? landmarks.map((point) => ({
          x: point.x,
          y: point.y,
          z: point.z || 0
        }))
      : compactFaceLandmarks(landmarks);
    exportData.face_landmark_count = landmarks.length;
  }

  const hands = {
    ...compactHandLandmarks(latestResults?.leftHandLandmarks, "left"),
    ...compactHandLandmarks(latestResults?.rightHandLandmarks, "right")
  };
  if (Object.keys(hands).length) {
    exportData.hands = hands;
  }

  return exportData;
}

function hasDetectedData(data) {
  return Boolean(data.body || data.face || data.hands);
}

function setModelsLoaded(ready, message = "Models loaded") {
  if (modelsLoadedTextEl) modelsLoadedTextEl.textContent = message;
  modelsLoadedIndicatorEl?.classList.toggle("is-ready", ready);
}

function markExportTime() {
  lastExportAt = Date.now();
  if (lastExportTimeEl) lastExportTimeEl.textContent = "just now";
}

function refreshExportTimeLabel() {
  if (!lastExportAt || !lastExportTimeEl) return;
  const seconds = Math.max(0, (Date.now() - lastExportAt) / 1000);
  if (seconds < 2) {
    lastExportTimeEl.textContent = "just now";
    return;
  }
  lastExportTimeEl.textContent = `${seconds.toFixed(1)}s ago`;
}

function splitHandRows(hands) {
  const left = {};
  const right = {};
  if (!hands) return { left, right };
  Object.entries(hands).forEach(([name, point]) => {
    if (name.startsWith("left_")) {
      left[name.replace(/^left_/, "")] = point;
    } else if (name.startsWith("right_")) {
      right[name.replace(/^right_/, "")] = point;
    }
  });
  return { left, right };
}

function formatLabel(name) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function updateTrackingFooters(exportData) {
  const bodyActive = Boolean(exportData.body);
  const faceActive = Boolean(exportData.face);
  const leftActive = Boolean(latestResults?.leftHandLandmarks?.length);
  const rightActive = Boolean(latestResults?.rightHandLandmarks?.length);

  if (bodyTrackingMetaEl) {
    bodyTrackingMetaEl.textContent = bodyActive
      ? "Tracking active · 33 pts"
      : "Tracking inactive · 33 pts";
  }
  if (faceTrackingMetaEl) {
    const count = latestResults?.faceLandmarks?.length || 468;
    faceTrackingMetaEl.textContent = faceActive
      ? `Tracking active · ${count} pts`
      : `Tracking inactive · ${count} pts`;
  }
  if (leftHandTrackingMetaEl) {
    leftHandTrackingMetaEl.textContent = leftActive
      ? "Tracking active · 21 pts"
      : "Tracking inactive · 21 pts";
  }
  if (rightHandTrackingMetaEl) {
    rightHandTrackingMetaEl.textContent = rightActive
      ? "Tracking active · 21 pts"
      : "Tracking inactive · 21 pts";
  }
}

function buildLandmarkTable(rows, withVisibility) {
  const head = withVisibility
    ? "<th>Landmark</th><th>X</th><th>Y</th><th>Z</th><th>Vis</th>"
    : "<th>Landmark</th><th>X</th><th>Y</th><th>Z</th>";

  const body = Object.entries(rows)
    .map(([name, point]) => {
      const cells = [
        `<td class="kp-name">${formatLabel(name)}</td>`,
        `<td>${point.x.toFixed(3)}</td>`,
        `<td>${point.y.toFixed(3)}</td>`,
        `<td>${(point.z || 0).toFixed(3)}</td>`
      ];
      if (withVisibility) {
        const vis = point.visibility ?? 0;
        cells.push(`<td><span class="kp-vis" style="--v:${vis}">${vis.toFixed(2)}</span></td>`);
      }
      return `<tr>${cells.join("")}</tr>`;
    })
    .join("");

  return `
    <table class="kp-table">
      <thead><tr>${head}</tr></thead>
      <tbody>${body}</tbody>
    </table>`;
}

// Pose connections for the body skeleton preview (MediaPipe pose indices).
const SKELETON_BONES = [
  [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
  [11, 23], [12, 24], [23, 24],
  [23, 25], [25, 27], [24, 26], [26, 28]
];

function fitLandmarks(points, width, height, pad) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  points.forEach((p) => {
    if (!p) return;
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  });
  const spanX = Math.max(maxX - minX, 1e-3);
  const spanY = Math.max(maxY - minY, 1e-3);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return (p) => ({ x: offX + (p.x - minX) * scale, y: offY + (p.y - minY) * scale });
}

function clearSkeleton(ctx, canvas, message) {
  resizeCanvasToDisplay(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(154,164,180,0.5)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
}

function drawBodySkeleton() {
  const ctx = bodySkeletonCtx;
  const canvas = bodySkeletonCanvas;
  resizeCanvasToDisplay(canvas);
  const lm = latestResults?.poseLandmarks;
  if (!lm) {
    clearSkeleton(ctx, canvas, "No body");
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const project = fitLandmarks(lm, canvas.width, canvas.height, 24);

  ctx.strokeStyle = "#00f0a8";
  ctx.lineWidth = 3;
  ctx.lineCap = "round";
  SKELETON_BONES.forEach(([a, b]) => {
    if (!lm[a] || !lm[b]) return;
    const p = project(lm[a]);
    const q = project(lm[b]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  });

  ctx.fillStyle = "#ffffff";
  Object.values(KEY_LANDMARKS).forEach((index) => {
    if (!lm[index]) return;
    const p = project(lm[index]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawFaceSkeleton() {
  const ctx = faceSkeletonCtx;
  const canvas = faceSkeletonCanvas;
  resizeCanvasToDisplay(canvas);
  const face = latestResults?.faceLandmarks;
  if (!face) {
    clearSkeleton(ctx, canvas, "No face");
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const project = fitLandmarks(face, canvas.width, canvas.height, 24);

  ctx.fillStyle = "rgba(89,166,255,0.85)";
  face.forEach((point) => {
    const p = project(point);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawHandSet(ctx, project, landmarks, color) {
  if (!landmarks) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = 2.3;
  ctx.lineCap = "round";
  (window.HAND_CONNECTIONS || []).forEach(([a, b]) => {
    if (!landmarks[a] || !landmarks[b]) return;
    const p = project(landmarks[a]);
    const q = project(landmarks[b]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  });

  ctx.fillStyle = "#ffffff";
  landmarks.forEach((point, index) => {
    const p = project(point);
    ctx.beginPath();
    ctx.arc(p.x, p.y, [0, 4, 8, 12, 16, 20].includes(index) ? 3.4 : 2.4, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawSingleHandSkeleton(ctx, canvas, landmarks, message, color) {
  resizeCanvasToDisplay(canvas);
  if (!landmarks?.length) {
    clearSkeleton(ctx, canvas, message);
    return;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const project = fitLandmarks(landmarks, canvas.width, canvas.height, 28);
  drawHandSet(ctx, project, landmarks, color);
}

function drawLeftHandSkeleton() {
  drawSingleHandSkeleton(
    leftHandSkeletonCtx,
    leftHandSkeletonCanvas,
    latestResults?.leftHandLandmarks,
    "No left hand",
    "#ff7bd5"
  );
}

function drawRightHandSkeleton() {
  drawSingleHandSkeleton(
    rightHandSkeletonCtx,
    rightHandSkeletonCanvas,
    latestResults?.rightHandLandmarks,
    "No right hand",
    "#59a6ff"
  );
}

function updateKeypointsPanel() {
  const exportData = buildCurrentExportData({ fullFace: false });
  const { left: leftHands, right: rightHands } = splitHandRows(exportData.hands);

  bodyTableEl.innerHTML = exportData.body
    ? buildLandmarkTable(exportData.body, true)
    : '<p class="kp-empty">No body detected yet...</p>';

  faceTableEl.innerHTML = exportData.face
    ? buildLandmarkTable(exportData.face, false)
    : '<p class="kp-empty">No face detected yet...</p>';

  leftHandTableEl.innerHTML = Object.keys(leftHands).length
    ? buildLandmarkTable(leftHands, false)
    : '<p class="kp-empty">No left hand detected yet...</p>';

  rightHandTableEl.innerHTML = Object.keys(rightHands).length
    ? buildLandmarkTable(rightHands, false)
    : '<p class="kp-empty">No right hand detected yet...</p>';

  drawBodySkeleton();
  drawFaceSkeleton();
  drawLeftHandSkeleton();
  drawRightHandSkeleton();
  updateTrackingFooters(exportData);
  refreshExportTimeLabel();

  if (!hasDetectedData(exportData)) {
    copyButton.disabled = true;
    setDetectionState("Searching");
    return;
  }
  copyButton.disabled = false;

  const labels = [];
  if (exportData.body) labels.push("Body");
  if (exportData.face) labels.push("Face");
  if (exportData.hands) labels.push("Hands");
  setDetectionState(labels.join(" + "));
}

function drawResults(image) {
  const mode = modeSelect.value;
  resizeOutputCanvasToDisplay();
  const { width: sourceWidth, height: sourceHeight } = getFrameDimensions(image);
  currentMediaRect = containRect(
    sourceWidth,
    sourceHeight,
    canvasElement.width,
    canvasElement.height
  );
  const displayPoseLandmarks = projectLandmarksToCanvas(latestResults?.poseLandmarks);
  const displayFaceLandmarks = projectLandmarksToCanvas(latestResults?.faceLandmarks);

  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.fillStyle = "#020306";
  canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(
    image,
    currentMediaRect.x,
    currentMediaRect.y,
    currentMediaRect.width,
    currentMediaRect.height
  );

  if (currentMediaRect.x > 0 || currentMediaRect.y > 0) {
    canvasCtx.strokeStyle = "rgba(255,255,255,0.08)";
    canvasCtx.lineWidth = 1;
    canvasCtx.strokeRect(
      currentMediaRect.x + 0.5,
      currentMediaRect.y + 0.5,
      currentMediaRect.width - 1,
      currentMediaRect.height - 1
    );
  }

  const showOverlay = overlaySkeletonToggle?.checked ?? true;

  if (showOverlay && visualStyleSelect.value === "glow") {
    collectGlowTrails(mode);
    drawGlowTrails();
  }

  if (showOverlay && (mode === "body" || mode === "both") && displayPoseLandmarks) {
    window.drawConnectors(canvasCtx, displayPoseLandmarks, window.POSE_CONNECTIONS, {
      color: visualStyleSelect.value === "glow" ? "rgba(0,255,180,0.65)" : "#00ff00",
      lineWidth: visualStyleSelect.value === "glow" ? 2 : 4
    });
    window.drawLandmarks(canvasCtx, displayPoseLandmarks, {
      color: visualStyleSelect.value === "glow" ? "rgba(255,255,255,0.85)" : "#ff3333",
      lineWidth: 2,
      radius: visualStyleSelect.value === "glow" ? 3 : 5
    });
  }

  if (showOverlay && (mode === "face" || mode === "both") && displayFaceLandmarks) {
    const landmarks = displayFaceLandmarks;
    if (visualStyleSelect.value !== "glow") {
      window.drawConnectors(canvasCtx, landmarks, window.FACEMESH_TESSELATION, {
        color: "#00ffff",
        lineWidth: 1
      });
    }
    window.drawConnectors(canvasCtx, landmarks, window.FACEMESH_FACE_OVAL, {
      color: "#ffffff",
      lineWidth: 2
    });
    window.drawConnectors(canvasCtx, landmarks, window.FACEMESH_LIPS, {
      color: "#ff4dff",
      lineWidth: 2
    });
    window.drawConnectors(canvasCtx, landmarks, window.FACEMESH_LEFT_EYE, {
      color: "#ffe768",
      lineWidth: 2
    });
    window.drawConnectors(canvasCtx, landmarks, window.FACEMESH_RIGHT_EYE, {
      color: "#ffe768",
      lineWidth: 2
    });
  }

  canvasCtx.restore();
}

function getFrameSource() {
  if (sourceSelect.value === "image") return imageLoaded ? imageElement : null;
  if (sourceSelect.value === "camera" && !cameraInstance) return null;
  return videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? videoElement : null;
}

function getFrameDimensions(source) {
  if (source === imageElement) {
    return {
      width: imageElement.naturalWidth || imageElement.width || 0,
      height: imageElement.naturalHeight || imageElement.height || 0
    };
  }

  return {
    width: videoElement.videoWidth || 1280,
    height: videoElement.videoHeight || 720
  };
}

async function processCurrentFrame() {
  const frameSource = getFrameSource();
  if (isProcessingFrame || !holistic || !frameSource) {
    return;
  }

  isProcessingFrame = true;
  frameTick += 1;
  try {
    await holistic.send({ image: frameSource });
    modelGallery?.updatePose(latestResults?.poseLandmarks);
    drawResults(frameSource);
    updateKeypointsPanel();
    const { width, height } = getFrameDimensions(frameSource);
    frameMetaEl.textContent = `${width} x ${height} ${getSourceLabel()}`;
  } catch (error) {
    console.warn("Frame processing error:", error);
    setStatus(`Frame processing error: ${error.message || "could not process frame"}`, "danger");
  } finally {
    isProcessingFrame = false;
  }
}

async function onFrame() {
  await processCurrentFrame();
}

function setupModels() {
  holistic = new window.Holistic({
    locateFile: (file) => `${MEDIAPIPE_HOLISTIC_ASSET_PATH}/${file}`
  });

  holistic.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    refineFaceLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });

  holistic.onResults((results) => {
    latestResults = results;
  });
}

function resetDetection() {
  latestResults = null;
  bodyTableEl.innerHTML = '<p class="kp-empty">Waiting for detection...</p>';
  faceTableEl.innerHTML = '<p class="kp-empty">Waiting for detection...</p>';
  leftHandTableEl.innerHTML = '<p class="kp-empty">Waiting for detection...</p>';
  rightHandTableEl.innerHTML = '<p class="kp-empty">Waiting for detection...</p>';
  clearSkeleton(bodySkeletonCtx, bodySkeletonCanvas, "No body");
  clearSkeleton(faceSkeletonCtx, faceSkeletonCanvas, "No face");
  clearSkeleton(leftHandSkeletonCtx, leftHandSkeletonCanvas, "No left hand");
  clearSkeleton(rightHandSkeletonCtx, rightHandSkeletonCanvas, "No right hand");
  copyButton.disabled = true;
  glowTrails = [];
  setDetectionState("Searching");
  updateTrackingFooters({});
}

function cancelAutoCameraStart() {
  if (!autoCameraTimer) return;
  window.clearTimeout(autoCameraTimer);
  autoCameraTimer = null;
}

function clearVideoObjectUrl() {
  if (!videoObjectUrl) return;
  URL.revokeObjectURL(videoObjectUrl);
  videoObjectUrl = null;
}

function clearImageObjectUrl() {
  if (!imageObjectUrl) return;
  URL.revokeObjectURL(imageObjectUrl);
  imageObjectUrl = null;
}

function clearImageSource() {
  clearImageObjectUrl();
  imageElement.removeAttribute("src");
  imageLoaded = false;
  currentImageName = "";
}

function cancelVideoLoop() {
  if (!videoLoopId) return;

  if ("cancelVideoFrameCallback" in videoElement) {
    videoElement.cancelVideoFrameCallback(videoLoopId);
  } else {
    window.cancelAnimationFrame(videoLoopId);
  }

  videoLoopId = null;
}

function cancelCameraLoop() {
  if (!cameraLoopId) return;

  window.cancelAnimationFrame(cameraLoopId);
  cameraLoopId = null;
}

function scheduleVideoLoop() {
  cancelVideoLoop();
  if (sourceSelect.value !== "video" || videoElement.paused || videoElement.ended) return;

  const handleFrame = async () => {
    videoLoopId = null;
    await processCurrentFrame();
    scheduleVideoLoop();
  };

  if ("requestVideoFrameCallback" in videoElement) {
    videoLoopId = videoElement.requestVideoFrameCallback(handleFrame);
  } else {
    videoLoopId = window.requestAnimationFrame(handleFrame);
  }
}

function stopCamera() {
  cancelCameraLoop();

  const stream = videoElement.srcObject;
  if (stream?.getTracks) {
    stream.getTracks().forEach((track) => track.stop());
  }

  if (cameraInstance?.stream && cameraInstance.stream !== stream) {
    cameraInstance.stream.getTracks().forEach((track) => track.stop());
  }

  cameraInstance = null;
  videoElement.srcObject = null;
}

function syncCameraButton() {
  retryButton.textContent = cameraInstance ? "Stop Camera" : "Start Camera";
  retryButton.disabled = false;
  if (restartCameraButton) restartCameraButton.disabled = !cameraInstance;
}

function stopCameraAndIdle(message = "Camera stopped.") {
  stopCamera();
  syncCameraButton();
  if (sourceSelect.value === "camera") {
    initCanvasPlaceholder("Click Start Camera to begin");
    setStatus(message, "warning");
    frameMetaEl.textContent = "Camera idle";
    setDetectionState("Idle");
  }
}

function scheduleCameraLoop() {
  cancelCameraLoop();

  if (sourceSelect.value !== "camera" || !cameraInstance) return;

  cameraLoopId = window.requestAnimationFrame(async () => {
    cameraLoopId = null;
    await onFrame();
    scheduleCameraLoop();
  });
}

async function restartCamera() {
  if (!cameraInstance) {
    setStatus("Start the camera first.", "warning");
    return;
  }
  stopCamera();
  resetDetection();
  await startCamera();
}

async function startCamera() {
  cancelAutoCameraStart();
  sourceSelect.value = "camera";
  cancelVideoLoop();
  cancelCameraLoop();
  videoElement.pause();
  setStatus("Requesting camera access...", "warning");
  resetDetection();

  clearVideoObjectUrl();
  clearImageSource();
  videoElement.removeAttribute("src");
  videoElement.load();
  videoLoaded = false;
  playVideoButton.disabled = true;
  restartVideoButton.disabled = true;
  retryButton.disabled = false;
  retryButton.textContent = "Requesting...";

  try {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("camera access is not supported in this browser");
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        facingMode: "user"
      }
    });

    if (sourceSelect.value !== "camera") {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }

    videoElement.srcObject = stream;
    videoElement.muted = true;
    videoElement.playsInline = true;
    await videoElement.play();

    cameraInstance = { stream };
    setStatus("Camera active. Move back for full body, closer for face detail.");
    frameMetaEl.textContent = "Camera active";
    syncCameraButton();
    scheduleCameraLoop();
  } catch (error) {
    stopCamera();
    const message = error?.name === "NotAllowedError" ? "permission denied" : error?.message;
    setStatus(
      `Camera error: ${message || "camera unavailable"}. Check browser permissions or use Video File mode.`,
      "danger"
    );
    frameMetaEl.textContent = "Camera unavailable";
    setDetectionState("Blocked");
    syncCameraButton();
  }
}

function stopVideoPlayback() {
  cancelVideoLoop();
  videoElement.pause();
}

async function playLoadedVideo() {
  if (!videoLoaded) {
    setStatus("Load a video file first.", "warning");
    return;
  }

  stopCamera();
  if (videoElement.ended) {
    videoElement.currentTime = 0;
  }

  try {
    await videoElement.play();
    playVideoButton.textContent = "Pause";
    setStatus("Video playing. Mushy is following detected motion.");
    scheduleVideoLoop();
  } catch (error) {
    setStatus(`Video playback error: ${error.message || "could not play file"}`, "danger");
  }
}

function pauseLoadedVideo() {
  stopVideoPlayback();
  playVideoButton.textContent = "Play / Pause";
  setStatus("Video paused.");
}

async function restartLoadedVideo() {
  if (!videoLoaded) return;
  videoElement.currentTime = 0;
  resetDetection();
  await processCurrentFrame();
  await playLoadedVideo();
}

function prepareMediaMode(kind) {
  cancelAutoCameraStart();
  stopCamera();
  stopVideoPlayback();
  resetDetection();
  sourceSelect.value = kind;
  retryButton.disabled = true;
  retryButton.textContent = "Start Camera";
}

function loadVideoFile(file) {
  if (!file) return;

  prepareMediaMode("video");
  clearImageSource();

  clearVideoObjectUrl();

  videoObjectUrl = URL.createObjectURL(file);
  videoElement.muted = true;
  videoElement.loop = Boolean(loopVideoToggle?.checked);
  videoElement.srcObject = null;
  videoElement.src = videoObjectUrl;
  videoElement.load();

  videoLoaded = false;
  playVideoButton.disabled = true;
  restartVideoButton.disabled = true;
  retryButton.disabled = true;
  frameMetaEl.textContent = `Loading ${file.name}...`;
  setStatus(`Loading video: ${file.name}`, "warning");
}

function loadImageFile(file) {
  if (!file) return;

  prepareMediaMode("image");
  clearVideoObjectUrl();
  videoElement.removeAttribute("src");
  videoElement.load();
  videoLoaded = false;

  clearImageObjectUrl();
  imageObjectUrl = URL.createObjectURL(file);
  imageLoaded = false;
  currentImageName = file.name;
  playVideoButton.disabled = true;
  restartVideoButton.disabled = true;
  frameMetaEl.textContent = `Loading ${file.name}...`;
  setStatus(`Loading image: ${file.name}`, "warning");
  imageElement.src = imageObjectUrl;
}

function loadMediaFile(file) {
  if (!file) return;
  if (file.type.startsWith("image/")) {
    loadImageFile(file);
    return;
  }
  if (file.type.startsWith("video/")) {
    loadVideoFile(file);
    return;
  }
  setStatus("Unsupported file type. Choose an image or video file.", "danger");
}

function switchSource(nextSource) {
  cancelAutoCameraStart();
  resetDetection();

  if (nextSource === "camera") {
    stopVideoPlayback();
    retryButton.disabled = false;
    retryButton.textContent = cameraInstance ? "Stop Camera" : "Start Camera";
    initCanvasPlaceholder("Click Start Camera to begin");
    setStatus("Camera mode ready. Click Start Camera when you want to grant camera access.", "warning");
    frameMetaEl.textContent = "Camera idle";
    return;
  }

  stopCamera();
  stopVideoPlayback();
  retryButton.disabled = true;
  retryButton.textContent = "Start Camera";

  if (nextSource === "image") {
    if (!imageLoaded) {
      initCanvasPlaceholder("Load an image file to begin");
      setStatus("Image mode ready. Choose a photo or image file to track.", "warning");
      frameMetaEl.textContent = "Waiting for image file...";
    } else {
      setStatus(`Image loaded: ${currentImageName || "photo"}.`);
      processCurrentFrame();
    }
    return;
  }

  if (!videoLoaded) {
    initCanvasPlaceholder("Load a video file to begin");
    setStatus("Video mode ready. Choose a video file to track.", "warning");
    frameMetaEl.textContent = "Waiting for video file...";
  } else {
    setStatus("Video mode ready. Press Play Video to track this file.");
    processCurrentFrame();
  }
}

async function copyKeypointsJSON() {
  const exportData = buildCurrentExportData();

  if (!hasDetectedData(exportData)) {
    setStatus("No keypoints detected yet. Stand in front of the camera.", "warning");
    return;
  }

  const json = JSON.stringify(exportData, null, 2);

  try {
    await navigator.clipboard.writeText(json);
    markExportTime();
    setStatus("Keypoints copied to clipboard.");
    window.setTimeout(() => {
      if (cameraInstance) {
        setStatus("Camera active. Move back for full body, closer for face detail.");
      }
    }, 1800);
  } catch {
    window.prompt("Copy this JSON:", json);
  }
}

function downloadSnapshot() {
  const link = document.createElement("a");
  link.download = `pose-snapshot-${Date.now()}.png`;
  link.href = canvasElement.toDataURL("image/png");
  link.click();
}

function bindEvents() {
  copyButton.addEventListener("click", copyKeypointsJSON);
  playVideoButton.addEventListener("click", () => {
    if (videoElement.paused || videoElement.ended) {
      playLoadedVideo();
    } else {
      pauseLoadedVideo();
    }
  });
  restartVideoButton.addEventListener("click", restartLoadedVideo);
  snapshotButton.addEventListener("click", downloadSnapshot);
  restartCameraButton?.addEventListener("click", restartCamera);
  driverExportBtn?.addEventListener("click", copyKeypointsJSON);
  retryButton.addEventListener("click", () => {
    if (cameraInstance) {
      stopCameraAndIdle();
    } else {
      startCamera();
    }
  });
  sourceSelect.addEventListener("change", () => switchSource(sourceSelect.value));
  videoFileInput.addEventListener("change", () => {
    const [file] = videoFileInput.files || [];
    loadMediaFile(file);
  });

  videoElement.addEventListener("loadeddata", async () => {
    if (sourceSelect.value !== "video") return;

    videoLoaded = true;
    playVideoButton.disabled = false;
    restartVideoButton.disabled = false;
    playVideoButton.textContent = "Play / Pause";
    setStatus("Video loaded. Press Play / Pause to start tracking.");
    frameMetaEl.textContent = `${videoElement.videoWidth || 0} x ${videoElement.videoHeight || 0} video file`;
    await processCurrentFrame();
  });

  videoElement.addEventListener("error", () => {
    if (sourceSelect.value !== "video") return;

    cancelVideoLoop();
    videoLoaded = false;
    playVideoButton.disabled = true;
    restartVideoButton.disabled = true;
    playVideoButton.textContent = "Play / Pause";
    const error = videoElement.error;
    setStatus(
      `Video error: ${error?.message || "could not load or decode this file"}. Try another video format.`,
      "danger"
    );
    frameMetaEl.textContent = "Video unavailable";
    setDetectionState("Blocked");
  });

  videoElement.addEventListener("ended", () => {
    if (sourceSelect.value !== "video") return;

    cancelVideoLoop();
    playVideoButton.textContent = "Play / Pause";
    setStatus("Video ended. Restart it to run tracking again.");
  });

  visualStyleSelect.addEventListener("change", () => {
    glowTrails = [];
    setStatus(`Visual style: ${visualStyleSelect.options[visualStyleSelect.selectedIndex].text}`);
    processCurrentFrame();
  });

  overlaySkeletonToggle?.addEventListener("change", () => {
    glowTrails = [];
    setStatus(`Main overlay: ${overlaySkeletonToggle.checked ? "on" : "off"}.`);
    processCurrentFrame();
  });

  loopVideoToggle?.addEventListener("change", () => {
    videoElement.loop = loopVideoToggle.checked;
    setStatus(`Video loop: ${loopVideoToggle.checked ? "on" : "off"}.`);
  });

  refreshModelsButton?.addEventListener("click", async () => {
    setStatus("Refreshing model gallery...", "warning");
    modelGallery?.dispose();
    await initModelGallery();
    setStatus("Model gallery refreshed.");
  });

  modeSelect.addEventListener("change", () => {
    resetDetection();
    setStatus(`Switched to ${modeSelect.options[modeSelect.selectedIndex].text} mode`);
    window.setTimeout(() => {
      if (sourceSelect.value === "camera" && cameraInstance) {
        setStatus("Camera active. Move back for full body, closer for face detail.");
      } else if (sourceSelect.value === "video" && videoLoaded) {
        setStatus(
          videoElement.paused
            ? "Video mode ready. Press Play Video to track this file."
            : "Video playing. Mushy is following detected motion."
        );
      } else if (sourceSelect.value === "image" && imageLoaded) {
        setStatus(`Image loaded: ${currentImageName || "photo"}.`);
      }
    }, 1200);
  });

  imageElement.addEventListener("load", async () => {
    if (sourceSelect.value !== "image") return;

    imageLoaded = true;
    playVideoButton.disabled = true;
    restartVideoButton.disabled = true;
    setStatus(`Image loaded: ${currentImageName || "photo"}. Tracking still landmarks.`);
    frameMetaEl.textContent = `${imageElement.naturalWidth || 0} x ${imageElement.naturalHeight || 0} image file`;
    await processCurrentFrame();
  });

  imageElement.addEventListener("error", () => {
    if (sourceSelect.value !== "image") return;

    imageLoaded = false;
    setStatus("Image error: could not load this file. Try another image.", "danger");
    frameMetaEl.textContent = "Image unavailable";
    setDetectionState("Blocked");
  });
}

function initCanvasPlaceholder(message = "Camera preview will appear here") {
  resizeOutputCanvasToDisplay();
  currentMediaRect = null;
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.fillStyle = "#05070a";
  canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.fillStyle = "rgba(255,255,255,0.78)";
  canvasCtx.font = `600 ${Math.max(18, Math.min(34, canvasElement.width * 0.02))}px system-ui, sans-serif`;
  canvasCtx.textAlign = "center";
  canvasCtx.textBaseline = "middle";
  canvasCtx.fillText(message, canvasElement.width / 2, canvasElement.height / 2);
}

async function initModelGallery() {
  modelGallery = new ModelGallery({
    bodyMount: bodyModelGalleryEl,
    faceMount: faceModelGalleryEl,
    heroMount: riggedModelMountEl,
    riggedModelMeta: riggedModelMetaEl,
    driverName: driverNameEl,
    driverMeta: driverMetaEl,
    driverAnimSelect: driverAnimSelectEl,
    onPrimaryChange: (avatar) => {
      window.__avatar = avatar;
    }
  });
  await modelGallery.init();
  window.__avatar = modelGallery.getPrimaryAvatar();
  window.__modelGallery = modelGallery;
  setModelsLoaded(true);
}

// Dev hook: load a same-origin video URL through the normal video pipeline.
function loadVideoURL(url) {
  prepareMediaMode("video");
  clearImageSource();
  clearVideoObjectUrl();
  videoElement.muted = true;
  videoElement.loop = Boolean(loopVideoToggle?.checked);
  videoElement.srcObject = null;
  videoElement.src = url;
  videoElement.load();
  videoLoaded = false;
  playVideoButton.disabled = true;
  restartVideoButton.disabled = true;
  frameMetaEl.textContent = "Loading video URL...";
  setStatus("Loading video URL...", "warning");
}

// Dev hook: load a same-origin image URL through the normal image pipeline.
function loadImageURL(url, name = "image") {
  prepareMediaMode("image");
  clearVideoObjectUrl();
  clearImageObjectUrl();
  videoElement.removeAttribute("src");
  videoElement.load();
  videoLoaded = false;
  imageLoaded = false;
  currentImageName = name;
  imageElement.src = url;
  frameMetaEl.textContent = "Loading image URL...";
  setStatus("Loading image URL...", "warning");
}

function init() {
  bindEvents();
  initCanvasPlaceholder();
  const stageResizeObserver = new ResizeObserver(() => {
    if (getFrameSource()) {
      processCurrentFrame();
    } else {
      initCanvasPlaceholder(
        sourceSelect.value === "camera" ? "Click Start Camera to begin" : "Load media to begin"
      );
    }
  });
  stageResizeObserver.observe(canvasElement);
  window.__loadVideoURL = loadVideoURL;
  window.__loadImageURL = loadImageURL;
  window.__playVideo = playLoadedVideo;
  window.__processFrame = processCurrentFrame;
  window.__video = videoElement;
  window.__image = imageElement;

  if (!window.isSecureContext && window.location.hostname !== "localhost") {
    setStatus("Webcam access needs HTTPS or localhost. Start this app with npm run dev.", "danger");
    return;
  }

  if (!hasMediaPipeGlobals()) {
    setStatus("MediaPipe did not load. Check your internet connection, then refresh.", "danger");
    return;
  }

  setStatus("Loading models... first run can take a few seconds.", "warning");
  retryButton.disabled = true;
  setupModels();
  initModelGallery()
    .catch((error) => {
      console.error(error);
      setStatus("Model gallery failed to load. Check public/models/registry.json.", "danger");
    })
    .finally(() => {
      retryButton.disabled = false;
      retryButton.textContent = "Start Camera";
      if (restartCameraButton) restartCameraButton.disabled = true;
      frameMetaEl.textContent = "Camera idle";
      setModelsLoaded(true);
      setStatus("Ready. Click Start Camera or load an image/video file to begin.", "success");
    });
}

window.addEventListener("load", init);
