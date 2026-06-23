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
const bodyTableEl = document.getElementById("bodyTable");
const faceTableEl = document.getElementById("faceTable");
const bodySkeletonCanvas = document.getElementById("bodySkeleton");
const faceSkeletonCanvas = document.getElementById("faceSkeleton");
const bodySkeletonCtx = bodySkeletonCanvas.getContext("2d");
const faceSkeletonCtx = faceSkeletonCanvas.getContext("2d");
const copyButton = document.getElementById("copyKeypoints");
const playVideoButton = document.getElementById("playVideo");
const restartVideoButton = document.getElementById("restartVideo");
const snapshotButton = document.getElementById("downloadSnapshot");
const retryButton = document.getElementById("retryCamera");
const frameMetaEl = document.getElementById("frameMeta");
const detectionStateEl = document.getElementById("detectionState");
const bodyModelGalleryEl = document.getElementById("bodyModelGallery");
const faceModelGalleryEl = document.getElementById("faceModelGallery");
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

function toCanvasPoint(landmark) {
  return {
    x: landmark.x * canvasElement.width,
    y: landmark.y * canvasElement.height
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

function buildCurrentExportData({ fullFace = true } = {}) {
  const mode = modeSelect.value;
  const exportData = {
    timestamp: new Date().toISOString(),
    mode,
    body: null,
    face: null
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

  return exportData;
}

function hasDetectedData(data) {
  return Boolean(data.body || data.face);
}

function formatLabel(name) {
  return name.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "rgba(154,164,180,0.5)";
  ctx.font = "12px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(message, canvas.width / 2, canvas.height / 2);
}

function drawBodySkeleton() {
  const ctx = bodySkeletonCtx;
  const canvas = bodySkeletonCanvas;
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

function updateKeypointsPanel() {
  const exportData = buildCurrentExportData({ fullFace: false });

  bodyTableEl.innerHTML = exportData.body
    ? buildLandmarkTable(exportData.body, true)
    : '<p class="kp-empty">No body detected yet...</p>';

  faceTableEl.innerHTML = exportData.face
    ? buildLandmarkTable(exportData.face, false)
    : '<p class="kp-empty">No face detected yet...</p>';

  drawBodySkeleton();
  drawFaceSkeleton();

  if (!hasDetectedData(exportData)) {
    copyButton.disabled = true;
    setDetectionState("Searching");
    return;
  }
  copyButton.disabled = false;

  const labels = [];
  if (exportData.body) labels.push("Body");
  if (exportData.face) labels.push("Face");
  setDetectionState(labels.join(" + "));
}

function drawResults(image) {
  const mode = modeSelect.value;
  canvasCtx.save();
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.drawImage(image, 0, 0, canvasElement.width, canvasElement.height);

  if (visualStyleSelect.value === "glow") {
    collectGlowTrails(mode);
    drawGlowTrails();
  }

  if ((mode === "body" || mode === "both") && latestResults?.poseLandmarks) {
    window.drawConnectors(canvasCtx, latestResults.poseLandmarks, window.POSE_CONNECTIONS, {
      color: visualStyleSelect.value === "glow" ? "rgba(0,255,180,0.65)" : "#00ff00",
      lineWidth: visualStyleSelect.value === "glow" ? 2 : 4
    });
    window.drawLandmarks(canvasCtx, latestResults.poseLandmarks, {
      color: visualStyleSelect.value === "glow" ? "rgba(255,255,255,0.85)" : "#ff3333",
      lineWidth: 2,
      radius: visualStyleSelect.value === "glow" ? 3 : 5
    });
  }

  if ((mode === "face" || mode === "both") && latestResults?.faceLandmarks) {
    const landmarks = latestResults.faceLandmarks;
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
  clearSkeleton(bodySkeletonCtx, bodySkeletonCanvas, "No body");
  clearSkeleton(faceSkeletonCtx, faceSkeletonCanvas, "No face");
  copyButton.disabled = true;
  glowTrails = [];
  setDetectionState("Searching");
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

function scheduleCameraLoop() {
  cancelCameraLoop();

  if (sourceSelect.value !== "camera" || !cameraInstance) return;

  cameraLoopId = window.requestAnimationFrame(async () => {
    cameraLoopId = null;
    await onFrame();
    scheduleCameraLoop();
  });
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
    retryButton.textContent = "Restart Camera";
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
    retryButton.textContent = "Retry Camera";
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
    playVideoButton.textContent = "Pause Video";
    setStatus("Video playing. Mushy is following detected motion.");
    scheduleVideoLoop();
  } catch (error) {
    setStatus(`Video playback error: ${error.message || "could not play file"}`, "danger");
  }
}

function pauseLoadedVideo() {
  stopVideoPlayback();
  playVideoButton.textContent = "Play Video";
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
  videoElement.loop = false;
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
    retryButton.textContent = cameraInstance ? "Restart Camera" : "Start Camera";
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
  retryButton.addEventListener("click", startCamera);
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
    playVideoButton.textContent = "Play Video";
    setStatus("Video loaded. Press Play Video to start tracking.");
    frameMetaEl.textContent = `${videoElement.videoWidth || 0} x ${videoElement.videoHeight || 0} video file`;
    await processCurrentFrame();
  });

  videoElement.addEventListener("error", () => {
    if (sourceSelect.value !== "video") return;

    cancelVideoLoop();
    videoLoaded = false;
    playVideoButton.disabled = true;
    restartVideoButton.disabled = true;
    playVideoButton.textContent = "Play Video";
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
    playVideoButton.textContent = "Play Video";
    setStatus("Video ended. Restart it to run tracking again.");
  });

  visualStyleSelect.addEventListener("change", () => {
    glowTrails = [];
    setStatus(`Visual style: ${visualStyleSelect.options[visualStyleSelect.selectedIndex].text}`);
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
  canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.fillStyle = "#05070a";
  canvasCtx.fillRect(0, 0, canvasElement.width, canvasElement.height);
  canvasCtx.fillStyle = "rgba(255,255,255,0.78)";
  canvasCtx.font = "600 30px system-ui, sans-serif";
  canvasCtx.textAlign = "center";
  canvasCtx.fillText(message, canvasElement.width / 2, canvasElement.height / 2);
}

async function initModelGallery() {
  modelGallery = new ModelGallery({
    bodyMount: bodyModelGalleryEl,
    faceMount: faceModelGalleryEl,
    onPrimaryChange: (avatar) => {
      window.__avatar = avatar;
    }
  });
  await modelGallery.init();
  window.__avatar = modelGallery.getPrimaryAvatar();
  window.__modelGallery = modelGallery;
}

// Dev hook: load a same-origin video URL through the normal video pipeline.
function loadVideoURL(url) {
  prepareMediaMode("video");
  clearImageSource();
  clearVideoObjectUrl();
  videoElement.muted = true;
  videoElement.loop = true;
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
      frameMetaEl.textContent = "Camera idle";
      setStatus("Ready. Click Start Camera or load an image/video file to begin.", "success");
    });
}

window.addEventListener("load", init);
