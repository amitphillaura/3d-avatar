import "./styles.css";
import { RigHost } from "./rigHost.js";
import { captureVideoPoster, getProjectMedia } from "./mediaLibrary.js";
import {
  facingFromMediaPipeZ,
  formatJointLabelWithFacing,
  torsoMidZFromPoseLandmarks
} from "./jointLabels.js";
import {
  POSE,
  POSE_BONE_CONNECTIONS,
  POSE_FOOT_CONNECTIONS,
  POSE_FOOT_JOINTS,
  shoulderMidFromPose
} from "./skeletonGraph.js";

const videoElement = document.createElement("video");
videoElement.setAttribute("playsinline", "");
videoElement.preload = "metadata";

const imageElement = new Image();
imageElement.decoding = "async";

const canvasElement = document.getElementById("output");
const canvasCtx = canvasElement.getContext("2d", { alpha: true });
const statusEl = document.getElementById("status");
const sourceSelect = document.getElementById("source");
const loadMediaFieldEl = document.getElementById("loadMediaField");
const cameraControlsEl = document.getElementById("cameraControls");
const videoControlsEl = document.getElementById("videoControls");
const rawPanelTitleEl = document.getElementById("rawPanelTitle");
const videoFileInput = document.getElementById("videoFile");
const modeSelect = document.getElementById("mode");
const visualStyleSelect = document.getElementById("visualStyle");
const overlaySkeletonToggle = document.getElementById("overlaySkeleton");
const trackFingersToggle = document.getElementById("trackFingers");
const swapHandsToggle = document.getElementById("swapHands");
const loopVideoToggle = document.getElementById("loopVideo");
const videoSoundToggle = document.getElementById("videoSound");
const SWAP_HANDS_STORAGE_KEY = "live-pose-swap-hands";
const FULL_SKELETON_LABELS_KEY = "live-pose-full-skeleton-labels";
const RIGGED_LABELS_KEY = "live-pose-rigged-labels";
const RIG_VARIANT_KEY = "live-pose-rig-variant";
const SKELETON_ZOOM_KEY = "live-pose-skeleton-zoom";
const RIG_ZOOM_KEY = "live-pose-rig-zoom";

// Zoom slider is symmetric (level -100..100, 0 = Normal). Map to a camera/draw factor so
// "Normal" sits dead-center while zoom-in gets more headroom than zoom-out. Kept modest.
const ZOOM_MIN_FACTOR = 0.5;
const ZOOM_MAX_FACTOR = 2;
let skeletonZoom = 1;

function zoomLevelToFactor(level) {
  const l = Math.max(-100, Math.min(100, Number(level) || 0));
  return l >= 0
    ? 1 + (l / 100) * (ZOOM_MAX_FACTOR - 1)
    : 1 + (l / 100) * (1 - ZOOM_MIN_FACTOR);
}

function readStoredZoomLevel(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return 0;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(-100, Math.min(100, n)) : 0;
  } catch {
    return 0;
  }
}

function updateZoomLabel(el, factor) {
  if (el) el.textContent = `Zoom ${Math.round(factor * 100)}%`;
}

function applySkeletonZoom(level, { persist = true } = {}) {
  const factor = zoomLevelToFactor(level);
  skeletonZoom = factor;
  updateZoomLabel(skeletonZoomLabel, factor);
  if (persist) {
    try {
      localStorage.setItem(SKELETON_ZOOM_KEY, String(level));
    } catch {
      // ignore storage failures
    }
  }
  drawFullSkeleton();
}

function applyRigZoom(level, { persist = true } = {}) {
  const factor = zoomLevelToFactor(level);
  updateZoomLabel(rigZoomLabel, factor);
  rigHost?.setZoom?.(factor);
  if (persist) {
    try {
      localStorage.setItem(RIG_ZOOM_KEY, String(level));
    } catch {
      // ignore storage failures
    }
  }
}

let showFullSkeletonJointLabels = true;

function applyVideoSound() {
  // Sound on = unmuted. Muted while scrubbing/seeking is fine; play() is user-gesture-driven.
  videoElement.muted = !(videoSoundToggle?.checked ?? false);
}
const bodyTableEl = document.getElementById("bodyTable");
const faceTableEl = document.getElementById("faceTable");
const leftHandTableEl = document.getElementById("leftHandTable");
const rightHandTableEl = document.getElementById("rightHandTable");
const fullSkeletonCanvas = document.getElementById("fullSkeleton");
const bodySkeletonCanvas = document.getElementById("bodySkeleton");
const faceSkeletonCanvas = document.getElementById("faceSkeleton");
const leftHandSkeletonCanvas = document.getElementById("leftHandSkeleton");
const rightHandSkeletonCanvas = document.getElementById("rightHandSkeleton");
const fullSkeletonCtx = fullSkeletonCanvas.getContext("2d");
const bodySkeletonCtx = bodySkeletonCanvas.getContext("2d");
const faceSkeletonCtx = faceSkeletonCanvas.getContext("2d");
const leftHandSkeletonCtx = leftHandSkeletonCanvas.getContext("2d");
const rightHandSkeletonCtx = rightHandSkeletonCanvas.getContext("2d");
const copyButton = document.getElementById("copyKeypoints");
const playVideoButton = document.getElementById("playVideo");
const restartVideoButton = document.getElementById("restartVideo");
const playbackSpeedInput = document.getElementById("playbackSpeed");
const playbackSpeedValueEl = document.getElementById("playbackSpeedValue");
const videoScrubInput = document.getElementById("videoScrub");
const videoScrubValueEl = document.getElementById("videoScrubValue");
const videoScrubDurationEl = document.getElementById("videoScrubDuration");
const snapshotButton = document.getElementById("downloadSnapshot");
const retryButton = document.getElementById("retryCamera");
const restartCameraButton = document.getElementById("restartCamera");
const frameMetaEl = document.getElementById("frameMeta");
const detectionStateEl = document.getElementById("detectionState");
const bodyTrackingMetaEl = document.getElementById("bodyTrackingMeta");
const fullSkeletonMetaEl = document.getElementById("fullSkeletonMeta");
const faceTrackingMetaEl = document.getElementById("faceTrackingMeta");
const leftHandTrackingMetaEl = document.getElementById("leftHandTrackingMeta");
const rightHandTrackingMetaEl = document.getElementById("rightHandTrackingMeta");
const riggedModelMountEl = document.getElementById("riggedModelMount");
const riggedModelMetaEl = document.getElementById("riggedModelMeta");
const fullSkeletonJointLabelsToggle = document.getElementById("fullSkeletonJointLabels");
const riggedJointLabelsToggle = document.getElementById("riggedJointLabels");
const rigVariantSelect = document.getElementById("rigVariant");
const skeletonZoomInput = document.getElementById("skeletonZoom");
const skeletonZoomReset = document.getElementById("skeletonZoomReset");
const skeletonZoomLabel = document.getElementById("skeletonZoomLabel");
const rigZoomInput = document.getElementById("rigZoom");
const rigZoomReset = document.getElementById("rigZoomReset");
const rigZoomLabel = document.getElementById("rigZoomLabel");
const exportPoseBtn = document.getElementById("exportPoseBtn");
const lastExportTimeEl = document.getElementById("lastExportTime");
const modelsLoadedIndicatorEl = document.getElementById("modelsLoadedIndicator");
const modelsLoadedTextEl = document.getElementById("modelsLoadedText");
const mediaLibraryEl = document.getElementById("mediaLibrary");

let latestResults = null;
let cameraInstance = null;
let glowTrails = [];
let frameTick = 0;
let holistic = null;
let rigHost = null;
let videoObjectUrl = null;
let imageObjectUrl = null;
let videoLoopId = null;
let cameraLoopId = null;
let autoCameraTimer = null;
let isProcessingFrame = false;
let videoLoaded = false;
let videoScrubbing = false;
// Whether playback was running when the user grabbed the scrub slider. Drives whether we
// resume on release: scrubbing while paused must STAY paused (play only via the button).
let wasPlayingBeforeScrub = false;

const VIDEO_SCRUB_FPS = 30;
let imageLoaded = false;
let currentImageName = "";
let currentMediaRect = null;
let lastExportAt = null;
let lastSourceAspect = 16 / 9;
let skeletonResizeObserver = null;

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
  right_ankle: 28,
  left_heel: 29,
  right_heel: 30,
  left_foot_index: 31,
  right_foot_index: 32
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

function getRawPanelTitle() {
  if (sourceSelect.value === "video") return "Raw Video File";
  if (sourceSelect.value === "image") return "Raw Photo / Image";
  return "Raw Webcam";
}

function getRawPlaceholderMessage() {
  if (sourceSelect.value === "video") {
    return videoLoaded ? "Press Play / Pause to track" : "Load a video file to begin";
  }
  if (sourceSelect.value === "image") {
    return imageLoaded ? "Tracking still image" : "Load a photo or image to begin";
  }
  return cameraInstance ? "Webcam live" : "Click Start Camera to begin";
}

function setMediaButtonLabel(button, icon, label) {
  if (!button) return;
  const iconEl = button.querySelector(".media-btn-icon");
  if (iconEl) iconEl.textContent = icon;
  // Use the first non-whitespace text node (the real label), not the indentation
  // whitespace before the icon span — otherwise the label gets duplicated.
  const labelNode = Array.from(button.childNodes).find(
    (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== ""
  );
  if (labelNode) {
    labelNode.textContent = ` ${label}`;
  } else {
    button.appendChild(document.createTextNode(` ${label}`));
  }
}

function applyPlaybackSpeed(percent = Number(playbackSpeedInput?.value || 100)) {
  const clamped = Math.max(10, Math.min(300, Math.round(percent)));
  videoElement.playbackRate = clamped / 100;
  if (playbackSpeedInput) playbackSpeedInput.value = String(clamped);
  if (playbackSpeedValueEl) playbackSpeedValueEl.textContent = `${clamped}%`;
}

function getVideoFrameCount() {
  const duration = videoElement.duration;
  if (!Number.isFinite(duration) || duration <= 0) return 0;
  return Math.max(1, Math.floor(duration * VIDEO_SCRUB_FPS));
}

function frameToTime(frame) {
  return frame / VIDEO_SCRUB_FPS;
}

function timeToFrame(time) {
  return Math.max(0, Math.round(time * VIDEO_SCRUB_FPS));
}

function updateVideoFrameMeta() {
  if (sourceSelect.value !== "video" || !videoLoaded) return;

  const frame = timeToFrame(videoElement.currentTime);
  const total = getVideoFrameCount();
  if (videoElement.paused || videoElement.ended) {
    frameMetaEl.textContent = `Frame ${frame} / ${total} · paused`;
    return;
  }

  frameMetaEl.textContent = `Frame ${frame} / ${total} · ${playbackSpeedValueEl?.textContent || "100%"}`;
}

function syncVideoScrubControls() {
  if (!videoScrubInput) return;

  const enabled = sourceSelect.value === "video" && videoLoaded;
  const frameCount = getVideoFrameCount();
  videoScrubInput.disabled = !enabled || frameCount <= 0;
  videoScrubInput.closest(".media-scrub")?.classList.toggle("is-disabled", videoScrubInput.disabled);

  if (!enabled || frameCount <= 0) {
    videoScrubInput.max = "0";
    videoScrubInput.value = "0";
    if (videoScrubValueEl) videoScrubValueEl.textContent = "0";
    if (videoScrubDurationEl) videoScrubDurationEl.textContent = "0";
    return;
  }

  videoScrubInput.max = String(frameCount);
  if (!videoScrubbing) {
    videoScrubInput.value = String(Math.min(timeToFrame(videoElement.currentTime), frameCount));
  }
  if (videoScrubValueEl) videoScrubValueEl.textContent = videoScrubInput.value;
  if (videoScrubDurationEl) videoScrubDurationEl.textContent = String(frameCount);
}

// Set currentTime and resolve only once the video has actually painted the sought frame.
// Setting currentTime is async; running MediaPipe before the seek completes reads the OLD
// frame, so the rig lags or appears frozen while scrubbing a paused video.
function waitForVideoSeek(time) {
  const target = Math.min(Math.max(time, 0), Math.max(videoElement.duration - 0.001, 0) || time);
  return new Promise((resolve) => {
    if (Math.abs(videoElement.currentTime - target) < 1e-3) {
      resolve();
      return;
    }
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      videoElement.removeEventListener("seeked", finish);
      resolve();
    };
    // Fallback in case 'seeked' never fires (e.g. identical frame / codec quirk).
    const timer = window.setTimeout(finish, 250);
    videoElement.addEventListener("seeked", finish, { once: true });
    videoElement.currentTime = target;
  });
}

async function seekVideoFrame(frame, { playAfter = false } = {}) {
  if (!videoLoaded) return;

  const frameCount = getVideoFrameCount();
  if (frameCount <= 0) return;

  const clampedFrame = Math.min(Math.max(Math.round(frame), 0), frameCount);
  const time = Math.min(frameToTime(clampedFrame), Math.max(videoElement.duration - 0.001, 0));

  stopVideoPlayback();
  await waitForVideoSeek(time);
  syncVideoScrubControls();
  await processCurrentFrame();

  if (playAfter) {
    await playLoadedVideo();
    return;
  }

  syncPlayButtonState();
  updateVideoFrameMeta();
}

function syncPlayButtonState() {
  if (!playVideoButton) return;
  const playing = videoLoaded && !videoElement.paused && !videoElement.ended;
  playVideoButton.classList.toggle("is-active", playing);
  setMediaButtonLabel(playVideoButton, playing ? "⏸" : "▶", playing ? "Pause" : "Play");
}

function syncCameraButtonState() {
  if (!retryButton) return;
  const active = Boolean(cameraInstance);
  retryButton.classList.toggle("is-active", active);
  retryButton.classList.toggle("media-btn--accent", !active);
  retryButton.classList.toggle("media-btn--stop", active);
  setMediaButtonLabel(retryButton, active ? "⏹" : "▶", active ? "Stop Camera" : "Start Camera");
}

function syncSourceUI() {
  const source = sourceSelect.value;
  const isCamera = source === "camera";
  const isVideo = source === "video";
  const isImage = source === "image";

  if (rawPanelTitleEl) rawPanelTitleEl.textContent = getRawPanelTitle();
  if (loadMediaFieldEl) loadMediaFieldEl.hidden = isCamera;
  if (cameraControlsEl) cameraControlsEl.hidden = !isCamera;
  if (videoControlsEl) videoControlsEl.hidden = !isVideo;
  if (videoFileInput) {
    videoFileInput.accept = isImage ? "image/*" : isVideo ? "video/*" : "image/*,video/*";
  }

  if (isCamera) {
    retryButton.disabled = false;
    if (restartCameraButton) restartCameraButton.disabled = !cameraInstance;
    syncCameraButtonState();
  } else {
    retryButton.disabled = true;
    retryButton.classList.remove("is-active", "media-btn--stop");
    retryButton.classList.add("media-btn--accent");
    setMediaButtonLabel(retryButton, "▶", "Start Camera");
    if (restartCameraButton) restartCameraButton.disabled = true;
  }

  if (isVideo) {
    playVideoButton.disabled = !videoLoaded;
    restartVideoButton.disabled = !videoLoaded;
    if (playbackSpeedInput) {
      playbackSpeedInput.disabled = !videoLoaded;
      playbackSpeedInput.closest(".media-speed")?.classList.toggle("is-disabled", !videoLoaded);
    }
    syncVideoScrubControls();
    syncPlayButtonState();
  } else {
    playVideoButton.disabled = true;
    restartVideoButton.disabled = true;
    playVideoButton.classList.remove("is-active");
    setMediaButtonLabel(playVideoButton, "▶", "Play");
    if (playbackSpeedInput) {
      playbackSpeedInput.disabled = true;
      playbackSpeedInput.closest(".media-speed")?.classList.toggle("is-disabled", true);
    }
    syncVideoScrubControls();
  }
}

function refreshRawPanel() {
  if (getFrameSource()) {
    processCurrentFrame();
    return;
  }

  initCanvasPlaceholder(getRawPlaceholderMessage());
  syncVizPlayerLayout();
  if (sourceSelect.value === "camera") {
    frameMetaEl.textContent = cameraInstance ? "Camera active" : "Camera idle";
    setDetectionState(cameraInstance ? "Searching" : "Idle");
  } else if (sourceSelect.value === "video") {
    if (videoLoaded) {
      updateVideoFrameMeta();
    } else {
      frameMetaEl.textContent = "Waiting for video file...";
    }
    setDetectionState("Idle");
  } else {
    frameMetaEl.textContent = imageLoaded
      ? `${imageElement.naturalWidth || 0} x ${imageElement.naturalHeight || 0} image file`
      : "Waiting for image file...";
    setDetectionState("Idle");
  }
}

function resizeCanvasToDisplay(canvas) {
  const parent = canvas.parentElement;
  const width = Math.max(
    1,
    Math.round(parent?.clientWidth || canvas.getBoundingClientRect().width || canvas.clientWidth || canvas.width)
  );
  const height = Math.max(
    1,
    Math.round(parent?.clientHeight || canvas.getBoundingClientRect().height || canvas.clientHeight || canvas.height)
  );

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

function getAspectDrawRect(canvasWidth, canvasHeight, aspect) {
  return containRect(aspect, 1, canvasWidth, canvasHeight);
}

function createLandmarkProjector(points, drawRect, pad = 16, aspect = 1) {
  const innerProject = fitLandmarks(points, drawRect.width, drawRect.height, pad, aspect);
  return (landmark) => {
    const point = innerProject(landmark);
    return { x: drawRect.x + point.x, y: drawRect.y + point.y };
  };
}

function mergeLandmarkSets(...sets) {
  const merged = [];
  sets.forEach((set) => {
    if (!set) return;
    if (Array.isArray(set)) {
      set.forEach((point) => point && merged.push(point));
      return;
    }
    Object.values(set).forEach((point) => point && merged.push(point));
  });
  return merged;
}

function createUnifiedProjector(drawRect, pad = 18, aspect = 1, ...sets) {
  const merged = mergeLandmarkSets(...sets);
  if (!merged.length) return null;
  return createLandmarkProjector(merged, drawRect, pad, aspect);
}

// Wrap a projector so its output scales about the draw-rect center by `zoom`
// (1 = unchanged). Lets the Full Skeleton zoom without re-fitting the landmarks.
function zoomedProjector(project, drawRect, zoom) {
  if (!project || zoom === 1) return project;
  const cx = drawRect.x + drawRect.width / 2;
  const cy = drawRect.y + drawRect.height / 2;
  return (landmark) => {
    const p = project(landmark);
    return { x: cx + (p.x - cx) * zoom, y: cy + (p.y - cy) * zoom };
  };
}

function drawConnectorSet(ctx, project, landmarks, connections, color, lineWidth = 2) {
  if (!landmarks || !connections?.length) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineCap = "round";
  connections.forEach(([a, b]) => {
    if (!landmarks[a] || !landmarks[b]) return;
    const p = project(landmarks[a]);
    const q = project(landmarks[b]);
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
    ctx.stroke();
  });
}

function drawJointDots(ctx, project, landmarks, indices, radius = 3, color = "#ffffff") {
  if (!landmarks) return;
  ctx.fillStyle = color;
  indices.forEach((index) => {
    if (!landmarks[index]) return;
    const p = project(landmarks[index]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
    ctx.fill();
  });
}

function drawPoseJointLabels(ctx, project, pose) {
  if (!showFullSkeletonJointLabels || !pose) return;
  const torsoZ = torsoMidZFromPoseLandmarks(pose);

  Object.entries(KEY_LANDMARKS).forEach(([name, index]) => {
    const landmark = pose[index];
    if (!landmark) return;

    const point = project(landmark);
    const facing = facingFromMediaPipeZ(landmark.z || 0, torsoZ);
    const text = formatJointLabelWithFacing(name, facing);
    const isBack = facing === "B";
    const dotColor = isBack ? "#ff7bd5" : "#00f0a8";
    const textColor = isBack ? "#ffd4f0" : "#b8ffe8";

    ctx.beginPath();
    ctx.arc(point.x, point.y, 4.5, 0, Math.PI * 2);
    ctx.fillStyle = dotColor;
    ctx.fill();

    ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "bottom";
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "rgba(0,0,0,0.85)";
    ctx.fillStyle = textColor;
    ctx.strokeText(text, point.x, point.y - 6);
    ctx.fillText(text, point.x, point.y - 6);
  });
}

function paintSkeletonBackdrop(ctx, canvas, drawRect) {
  ctx.fillStyle = "#020306";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "rgba(255,255,255,0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(drawRect.x + 0.5, drawRect.y + 0.5, drawRect.width - 1, drawRect.height - 1);
}

function resizeOutputCanvasToDisplay() {
  resizeCanvasToDisplay(canvasElement);
}

function syncVizPlayerLayout() {
  const refPlayer = document.querySelector(".viz-card--raw .tile-player");
  if (!refPlayer) return;

  const height = Math.max(1, Math.round(refPlayer.clientHeight));
  document.documentElement.style.setProperty("--viz-player-height", `${height}px`);
  document.documentElement.style.setProperty("--viz-aspect", String(getSourceAspectRatio()));

  // The Raw tile's footer holds the always-on media controls, so it's taller than the
  // other tiles' one-line footers. Publish its height so the Full Skeleton + Rig footers
  // match it (CSS), keeping all three players the same size and aligned.
  const rawFooter = document.querySelector(".viz-card--raw .tile-footer");
  if (rawFooter) {
    const footerH = Math.max(1, Math.round(rawFooter.getBoundingClientRect().height));
    document.documentElement.style.setProperty("--tile-footer-h", `${footerH}px`);
  }

  window.__avatar?.resize?.();

  if (latestResults) {
    updateKeypointsPanel();
    return;
  }

  drawFullSkeleton();
  drawBodySkeleton();
  drawFaceSkeleton();
  drawLeftHandSkeleton();
  drawRightHandSkeleton();
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

  const { left: leftHandLm, right: rightHandLm } = getAnatomicalHands();
  const hands = {
    ...compactHandLandmarks(leftHandLm, "left"),
    ...compactHandLandmarks(rightHandLm, "right")
  };
  if (Object.keys(hands).length) {
    exportData.hands = hands;
  }

  return exportData;
}

function hasDetectedData(data) {
  return Boolean(data.body || data.face || data.hands);
}

function setModelsLoaded(ready, message = "MediaPipe ready") {
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
  const { left: leftHandLm, right: rightHandLm } = getAnatomicalHands();
  const leftActive = Boolean(leftHandLm?.length);
  const rightActive = Boolean(rightHandLm?.length);

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

  if (fullSkeletonMetaEl) {
    const parts = [];
    if (bodyActive) parts.push("body");
    if (faceActive) parts.push("head");
    if (leftActive) parts.push("L hand");
    if (rightActive) parts.push("R hand");
    if (bodyActive && latestResults?.poseLandmarks?.[POSE.leftHeel]) parts.push("feet");
    fullSkeletonMetaEl.textContent = parts.length
      ? `Tracking · ${parts.join(" + ")}`
      : "Body + head + hands · waiting for tracking";
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
const SKELETON_BONES = POSE_BONE_CONNECTIONS;

function getSourceAspectRatio() {
  const source = getFrameSource();
  if (source) {
    const { width, height } = getFrameDimensions(source);
    if (width > 0 && height > 0) {
      lastSourceAspect = width / height;
      return lastSourceAspect;
    }
  }
  if (videoElement.videoWidth > 0 && videoElement.videoHeight > 0) {
    lastSourceAspect = videoElement.videoWidth / videoElement.videoHeight;
    return lastSourceAspect;
  }
  if (imageElement.naturalWidth > 0 && imageElement.naturalHeight > 0) {
    lastSourceAspect = imageElement.naturalWidth / imageElement.naturalHeight;
    return lastSourceAspect;
  }
  return lastSourceAspect;
}

function fitLandmarks(points, width, height, pad, aspect = 1) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  points.forEach((p) => {
    if (!p) return;
    const px = p.x * aspect;
    const py = p.y;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  });
  const spanX = Math.max(maxX - minX, 1e-3);
  const spanY = Math.max(maxY - minY, 1e-3);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const offX = (width - spanX * scale) / 2;
  const offY = (height - spanY * scale) / 2;
  return (p) => ({
    x: offX + (p.x * aspect - minX) * scale,
    y: offY + (p.y - minY) * scale
  });
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

  const aspect = getSourceAspectRatio();
  const drawRect = getAspectDrawRect(canvas.width, canvas.height, aspect);
  paintSkeletonBackdrop(ctx, canvas, drawRect);
  const project = createLandmarkProjector(lm, drawRect, 24, aspect);

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

  const shoulderMid = shoulderMidFromPose(lm);
  if (shoulderMid && lm[POSE.nose]) {
    drawConnectorSet(
      ctx,
      project,
      { 0: shoulderMid, 1: lm[POSE.nose] },
      [[0, 1]],
      "#9eefff",
      2.6
    );
  }

  drawConnectorSet(ctx, project, lm, POSE_FOOT_CONNECTIONS, "#75a7ff", 2.4);
  drawJointDots(ctx, project, lm, POSE_FOOT_JOINTS, 2.6, "#75a7ff");
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

  const aspect = getSourceAspectRatio();
  const drawRect = getAspectDrawRect(canvas.width, canvas.height, aspect);
  paintSkeletonBackdrop(ctx, canvas, drawRect);
  const project = createLandmarkProjector(face, drawRect, 20, aspect);

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

// Draw the short connector from a hand skeleton's root to whichever pose wrist
// (15=left, 16=right) is physically closest. Swap-invariant: if the hand arrays are
// swapped, the root still bridges to its true wrist instead of stretching across the body.
function bridgeHandToNearestWrist(ctx, project, pose, hand, color) {
  if (!pose || !hand?.length) return;
  const root = hand[0];
  const lw = pose[15];
  const rw = pose[16];
  const wrist = !lw ? rw : !rw ? lw : sqDist(root, lw) <= sqDist(root, rw) ? lw : rw;
  if (!wrist) return;
  drawConnectorSet(ctx, project, { 0: wrist, 1: root }, [[0, 1]], color, 2.4);
}

function sqDist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

function drawSingleHandSkeleton(ctx, canvas, landmarks, message, color) {
  resizeCanvasToDisplay(canvas);
  if (!landmarks?.length) {
    clearSkeleton(ctx, canvas, message);
    return;
  }

  const aspect = getSourceAspectRatio();
  const drawRect = getAspectDrawRect(canvas.width, canvas.height, aspect);
  paintSkeletonBackdrop(ctx, canvas, drawRect);
  const project = createLandmarkProjector(landmarks, drawRect, 24, aspect);
  drawHandSet(ctx, project, landmarks, color);
}

function drawLeftHandSkeleton() {
  const { left } = getAnatomicalHands();
  drawSingleHandSkeleton(
    leftHandSkeletonCtx,
    leftHandSkeletonCanvas,
    left,
    "No left hand",
    "#ff7bd5"
  );
}

function drawRightHandSkeleton() {
  const { right } = getAnatomicalHands();
  drawSingleHandSkeleton(
    rightHandSkeletonCtx,
    rightHandSkeletonCanvas,
    right,
    "No right hand",
    "#59a6ff"
  );
}

function drawFullSkeleton() {
  const ctx = fullSkeletonCtx;
  const canvas = fullSkeletonCanvas;
  const pose = latestResults?.poseLandmarks;
  const face = latestResults?.faceLandmarks;
  const { left: leftHand, right: rightHand } = getAnatomicalHands();

  resizeCanvasToDisplay(canvas);

  if (!pose && !face && !leftHand?.length && !rightHand?.length) {
    clearSkeleton(ctx, canvas, "No tracking");
    return;
  }

  const aspect = getSourceAspectRatio();
  const drawRect = getAspectDrawRect(canvas.width, canvas.height, aspect);
  paintSkeletonBackdrop(ctx, canvas, drawRect);
  const baseProject = createUnifiedProjector(drawRect, 16, aspect, pose, face, leftHand, rightHand);
  if (!baseProject) {
    clearSkeleton(ctx, canvas, "No tracking");
    return;
  }
  const project = zoomedProjector(baseProject, drawRect, skeletonZoom);

  // Keep zoomed-in strokes inside the letterboxed draw area instead of bleeding into
  // the surrounding tile bars.
  ctx.save();
  ctx.beginPath();
  ctx.rect(drawRect.x, drawRect.y, drawRect.width, drawRect.height);
  ctx.clip();

  if (pose) {
    drawConnectorSet(ctx, project, pose, SKELETON_BONES, "#00f0a8", 3.2);
    if (showFullSkeletonJointLabels) {
      drawPoseJointLabels(ctx, project, pose);
    } else {
      drawJointDots(ctx, project, pose, Object.values(KEY_LANDMARKS), 3, "#ffffff");
    }

    const shoulderMid = shoulderMidFromPose(pose);
    if (shoulderMid && pose[POSE.nose]) {
      drawConnectorSet(
        ctx,
        project,
        { 0: shoulderMid, 1: pose[POSE.nose] },
        [[0, 1]],
        "#9eefff",
        2.8
      );
    }

    drawConnectorSet(ctx, project, pose, POSE_FOOT_CONNECTIONS, "#75a7ff", 2.4);
    drawJointDots(ctx, project, pose, POSE_FOOT_JOINTS, 2.6, "#75a7ff");
  }

  if (face) {
    drawConnectorSet(ctx, project, face, window.FACEMESH_FACE_OVAL, "rgba(255,255,255,0.92)", 2);
    drawConnectorSet(ctx, project, face, window.FACEMESH_LIPS, "#ff4dff", 1.8);
    drawConnectorSet(ctx, project, face, window.FACEMESH_LEFT_EYE, "#ffe768", 1.6);
    drawConnectorSet(ctx, project, face, window.FACEMESH_RIGHT_EYE, "#ffe768", 1.6);
    drawJointDots(ctx, project, face, [1, 33, 263, 61, 291, 199, 175], 2.2, "#59a6ff");
  }

  drawHandSet(ctx, project, leftHand, "#ff7bd5");
  drawHandSet(ctx, project, rightHand, "#59a6ff");

  // Bridge each hand skeleton to its NEAREST pose wrist. Pairing by hardcoded index
  // (pose[15]→leftHand) breaks when "Swap Hands (L/R)" swaps the landmark arrays: the
  // hand roots move across the body while the wrists don't, stretching the bridge into a
  // band across the torso. Nearest-wrist pairing is swap-invariant.
  bridgeHandToNearestWrist(ctx, project, pose, leftHand, "#ff7bd5");
  bridgeHandToNearestWrist(ctx, project, pose, rightHand, "#59a6ff");

  ctx.restore();
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

  drawFullSkeleton();
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
  syncVizPlayerLayout();
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

  const showHands =
    showOverlay &&
    (mode === "body" ||
      mode === "both" ||
      latestResults?.leftHandLandmarks?.length ||
      latestResults?.rightHandLandmarks?.length);

  if (showHands) {
    drawHandOverlay(latestResults?.leftHandLandmarks, "#ff7bd5");
    drawHandOverlay(latestResults?.rightHandLandmarks, "#59a6ff");
  }

  canvasCtx.restore();
}

function drawHandOverlay(landmarks, color) {
  if (!landmarks?.length || !window.HAND_CONNECTIONS) return;
  const projected = projectLandmarksToCanvas(landmarks);
  window.drawConnectors(canvasCtx, projected, window.HAND_CONNECTIONS, {
    color,
    lineWidth: 2.5
  });
  window.drawLandmarks(canvasCtx, projected, {
    color: "#ffffff",
    lineWidth: 1,
    radius: 2.5
  });
}

function getFrameSource() {
  if (sourceSelect.value === "image") {
    return imageLoaded ? imageElement : null;
  }
  if (sourceSelect.value === "camera") {
    if (!cameraInstance) return null;
    return videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? videoElement : null;
  }
  if (sourceSelect.value === "video") {
    if (!videoLoaded) return null;
    return videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA ? videoElement : null;
  }
  return null;
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

// MediaPipe Holistic often labels left/right hands swapped for front-facing recorded
// video. Correcting it once here fixes the Left/Right panels AND the rigged model wrists
// together (the rig anchors each hand to its pose wrist).
function applyHandSwap() {
  if (!swapHandsToggle?.checked || !latestResults) return;
  const tmp = latestResults.leftHandLandmarks;
  latestResults.leftHandLandmarks = latestResults.rightHandLandmarks;
  latestResults.rightHandLandmarks = tmp;
}

// Person-relative left/right hand arrays for UI. When the toggle is off, MediaPipe still
// labels from the camera POV — swap for display/export only. When on, applyHandSwap() has
// already corrected latestResults so pass through unchanged.
function getAnatomicalHands() {
  if (!latestResults) return { left: null, right: null };
  const left = latestResults.leftHandLandmarks;
  const right = latestResults.rightHandLandmarks;
  if (swapHandsToggle?.checked) {
    return { left, right };
  }
  return { left: right, right: left };
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
    applyHandSwap();
    const { width, height } = getFrameDimensions(frameSource);
    if (width > 0 && height > 0) lastSourceAspect = width / height;
    rigHost?.updateTracking(latestResults, {
      video: frameSource === videoElement ? videoElement : null,
      width,
      height
    });
    drawResults(frameSource);
    updateKeypointsPanel();
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
  rigHost?.resetTracking?.();
  bodyTableEl.innerHTML = '<p class="kp-empty">Waiting for detection...</p>';
  faceTableEl.innerHTML = '<p class="kp-empty">Waiting for detection...</p>';
  leftHandTableEl.innerHTML = '<p class="kp-empty">Waiting for detection...</p>';
  rightHandTableEl.innerHTML = '<p class="kp-empty">Waiting for detection...</p>';
  clearSkeleton(fullSkeletonCtx, fullSkeletonCanvas, "No tracking");
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

function stopCameraAndIdle(message = "Camera stopped.") {
  stopCamera();
  syncSourceUI();
  if (sourceSelect.value === "camera") {
    refreshRawPanel();
    setStatus(message, "warning");
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
  syncSourceUI();
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
  retryButton.textContent = "Requesting...";
  refreshRawPanel();

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
    syncSourceUI();
    refreshRawPanel();
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
    syncSourceUI();
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
  applyVideoSound();

  try {
    await videoElement.play();
    applyPlaybackSpeed();
    syncPlayButtonState();
    updateVideoFrameMeta();
    setStatus(`Video playing at ${playbackSpeedValueEl?.textContent || "100%"}. Mushy is following detected motion.`);
    scheduleVideoLoop();
  } catch (error) {
    setStatus(`Video playback error: ${error.message || "could not play file"}`, "danger");
  }
}

function pauseLoadedVideo() {
  stopVideoPlayback();
  syncPlayButtonState();
  updateVideoFrameMeta();
  setStatus("Video paused.");
}

async function restartLoadedVideo() {
  if (!videoLoaded) return;
  videoElement.currentTime = 0;
  resetDetection();
  syncVideoScrubControls();
  await processCurrentFrame();
  await playLoadedVideo();
}

function prepareMediaMode(kind) {
  cancelAutoCameraStart();
  stopCamera();
  stopVideoPlayback();
  resetDetection();
  sourceSelect.value = kind;
  syncSourceUI();
}

function loadVideoFile(file) {
  if (!file) return;

  prepareMediaMode("video");
  clearImageSource();

  clearVideoObjectUrl();

  videoObjectUrl = URL.createObjectURL(file);
  applyVideoSound();
  videoElement.loop = Boolean(loopVideoToggle?.checked);
  applyPlaybackSpeed();
  videoElement.srcObject = null;
  videoElement.src = videoObjectUrl;
  videoElement.load();

  videoLoaded = false;
  frameMetaEl.textContent = `Loading ${file.name}...`;
  setStatus(`Loading video: ${file.name}`, "warning");
  syncSourceUI();
  refreshRawPanel();
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
  frameMetaEl.textContent = `Loading ${file.name}...`;
  setStatus(`Loading image: ${file.name}`, "warning");
  syncSourceUI();
  imageElement.src = imageObjectUrl;
}

function loadMediaFile(file) {
  if (!file) return;
  if (file.type.startsWith("image/")) {
    sourceSelect.value = "image";
    loadImageFile(file);
    return;
  }
  if (file.type.startsWith("video/")) {
    sourceSelect.value = "video";
    loadVideoFile(file);
    return;
  }
  setStatus("Unsupported file type. Choose an image or video file.", "danger");
}

function switchSource(nextSource) {
  cancelAutoCameraStart();
  resetDetection();
  sourceSelect.value = nextSource;
  syncSourceUI();

  if (nextSource === "camera") {
    stopVideoPlayback();
    if (!cameraInstance) {
      refreshRawPanel();
      setStatus("Camera mode ready. Click Start Camera when you want to grant camera access.", "warning");
      return;
    }
    refreshRawPanel();
    setStatus("Camera active. Move back for full body, closer for face detail.");
    return;
  }

  stopCamera();
  stopVideoPlayback();

  if (nextSource === "image") {
    if (!imageLoaded) {
      refreshRawPanel();
      setStatus("Image mode ready. Choose a photo or image file to track.", "warning");
    } else {
      setStatus(`Image loaded: ${currentImageName || "photo"}.`);
      refreshRawPanel();
    }
    return;
  }

  if (!videoLoaded) {
    refreshRawPanel();
    setStatus("Video mode ready. Choose a video file to track.", "warning");
  } else {
    setStatus("Video mode ready. Press Play / Pause to track this file.");
    refreshRawPanel();
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
  exportPoseBtn?.addEventListener("click", copyKeypointsJSON);
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
    syncSourceUI();
    setStatus("Video loaded. Press Play / Pause to start tracking.");
    syncVideoScrubControls();
    await processCurrentFrame();
    updateVideoFrameMeta();
  });

  videoElement.addEventListener("error", () => {
    if (sourceSelect.value !== "video") return;

    cancelVideoLoop();
    videoLoaded = false;
    syncSourceUI();
    const error = videoElement.error;
    setStatus(
      `Video error: ${error?.message || "could not load or decode this file"}. Try another video format.`,
      "danger"
    );
    refreshRawPanel();
    setDetectionState("Blocked");
  });

  videoElement.addEventListener("ended", () => {
    if (sourceSelect.value !== "video") return;

    cancelVideoLoop();
    syncPlayButtonState();
    updateVideoFrameMeta();
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

  trackFingersToggle?.addEventListener("change", () => {
    rigHost?.setTrackFingers?.(trackFingersToggle.checked);
    setStatus(`Rigged finger tracking: ${trackFingersToggle.checked ? "on" : "off"}.`);
  });

  swapHandsToggle?.addEventListener("change", () => {
    try {
      localStorage.setItem(SWAP_HANDS_STORAGE_KEY, swapHandsToggle.checked ? "1" : "0");
    } catch {
      // ignore storage failures
    }
    setStatus(`Hands L/R: ${swapHandsToggle.checked ? "swapped" : "normal"}.`);
    processCurrentFrame();
  });

  fullSkeletonJointLabelsToggle?.addEventListener("change", () => {
    showFullSkeletonJointLabels = fullSkeletonJointLabelsToggle.checked;
    try {
      localStorage.setItem(FULL_SKELETON_LABELS_KEY, showFullSkeletonJointLabels ? "1" : "0");
    } catch {
      // ignore storage failures
    }
    if (latestResults) updateKeypointsPanel();
    else drawFullSkeleton();
  });

  riggedJointLabelsToggle?.addEventListener("change", () => {
    try {
      localStorage.setItem(RIGGED_LABELS_KEY, riggedJointLabelsToggle.checked ? "1" : "0");
    } catch {
      // ignore storage failures
    }
    rigHost?.setShowJointLabels?.(riggedJointLabelsToggle.checked);
  });

  rigVariantSelect?.addEventListener("change", () => {
    try {
      localStorage.setItem(RIG_VARIANT_KEY, rigVariantSelect.value);
    } catch {
      // ignore storage failures
    }
    rigHost?.setVariant?.(rigVariantSelect.value);
    // The avatar instance was rebuilt — repoint the debug hook and re-feed the current
    // frame so a paused video/still shows the new rig immediately (camera streams anyway).
    window.__avatar = rigHost?.avatar ?? null;
    const label =
      rigVariantSelect.options[rigVariantSelect.selectedIndex]?.text || rigVariantSelect.value;
    setStatus(`Rig: ${label}.`);
    if (getFrameSource()) processCurrentFrame();
  });

  skeletonZoomInput?.addEventListener("input", () => applySkeletonZoom(skeletonZoomInput.value));
  skeletonZoomReset?.addEventListener("click", () => {
    if (skeletonZoomInput) skeletonZoomInput.value = "0";
    applySkeletonZoom(0);
  });

  rigZoomInput?.addEventListener("input", () => applyRigZoom(rigZoomInput.value));
  rigZoomReset?.addEventListener("click", () => {
    if (rigZoomInput) rigZoomInput.value = "0";
    applyRigZoom(0);
  });

  loopVideoToggle?.addEventListener("change", () => {
    videoElement.loop = loopVideoToggle.checked;
    setStatus(`Video loop: ${loopVideoToggle.checked ? "on" : "off"}.`);
  });

  videoSoundToggle?.addEventListener("change", () => {
    applyVideoSound();
    setStatus(`Video sound: ${videoSoundToggle.checked ? "on" : "off"}.`);
  });

  playbackSpeedInput?.addEventListener("input", () => {
    applyPlaybackSpeed(Number(playbackSpeedInput.value));
    updateVideoFrameMeta();
    setStatus(`Playback speed: ${playbackSpeedValueEl?.textContent || "100%"}.`);
  });

  videoScrubInput?.addEventListener("pointerdown", () => {
    if (videoScrubInput.disabled) return;
    wasPlayingBeforeScrub = videoLoaded && !videoElement.paused && !videoElement.ended;
    videoScrubbing = true;
    stopVideoPlayback();
    syncPlayButtonState();
  });

  videoScrubInput?.addEventListener("input", async () => {
    if (videoScrubInput.disabled) return;
    // Keyboard scrubbing (arrow keys) skips pointerdown — capture the play state here on
    // the first input of a session so release doesn't auto-resume a paused video.
    if (!videoScrubbing) {
      wasPlayingBeforeScrub = videoLoaded && !videoElement.paused && !videoElement.ended;
    }
    videoScrubbing = true;
    const frame = Number(videoScrubInput.value);
    if (videoScrubValueEl) videoScrubValueEl.textContent = String(frame);
    // Wait for the frame to actually paint before tracking, so the rig follows the scrub
    // instead of staying frozen on the pre-seek frame.
    await waitForVideoSeek(frameToTime(frame));
    await processCurrentFrame();
  });

  videoScrubInput?.addEventListener("change", async () => {
    if (videoScrubInput.disabled) return;
    videoScrubbing = false;
    // Only resume if we were playing when the drag began; scrubbing while paused stays paused.
    await seekVideoFrame(Number(videoScrubInput.value), { playAfter: wasPlayingBeforeScrub });
  });

  videoElement.addEventListener("loadedmetadata", () => {
    if (sourceSelect.value !== "video") return;
    syncVideoScrubControls();
  });

  videoElement.addEventListener("timeupdate", () => {
    if (sourceSelect.value !== "video" || videoScrubbing || !videoLoaded) return;
    syncVideoScrubControls();
    updateVideoFrameMeta();
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
    syncSourceUI();
    setStatus(`Image loaded: ${currentImageName || "photo"}. Tracking still landmarks.`);
    await processCurrentFrame();
  });

  imageElement.addEventListener("error", () => {
    if (sourceSelect.value !== "image") return;

    imageLoaded = false;
    syncSourceUI();
    setStatus("Image error: could not load this file. Try another image.", "danger");
    refreshRawPanel();
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

// Landmark tables live in toggle-on/off popups so the diagnostic tiles stay compact.
function setupLandmarkPopups() {
  const dataButtons = Array.from(document.querySelectorAll(".diag-data-btn"));
  const popups = Array.from(document.querySelectorAll(".kp-popup"));

  const closeAll = () => {
    popups.forEach((popup) => {
      popup.hidden = true;
    });
    dataButtons.forEach((btn) => btn.classList.remove("is-active"));
  };

  dataButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      const popup = document.getElementById(btn.dataset.popup);
      if (!popup) return;
      const willShow = popup.hidden;
      closeAll();
      popup.hidden = !willShow;
      btn.classList.toggle("is-active", willShow);
    });
  });

  document.querySelectorAll(".kp-popup-close").forEach((btn) => {
    btn.addEventListener("click", () => closeAll());
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeAll();
  });
}

async function initRigHost() {
  rigHost = new RigHost({
    mount: riggedModelMountEl,
    metaElement: riggedModelMetaEl,
    variant: rigVariantSelect?.value || "mushy"
  });
  rigHost.prepare({
    showJointLabels: riggedJointLabelsToggle?.checked ?? true,
    trackFingers: Boolean(trackFingersToggle?.checked)
  });
  rigHost.init();
  if (rigZoomInput) rigHost.setZoom(zoomLevelToFactor(rigZoomInput.value));
  window.__avatar = rigHost.avatar;
  window.__rigHost = rigHost;
  setModelsLoaded(true);
}

function setActiveMediaItem(url) {
  if (!mediaLibraryEl) return;
  mediaLibraryEl.querySelectorAll(".media-item").forEach((el) => {
    el.classList.toggle("is-active", el.dataset.url === url);
  });
}

function buildMediaItem(entry) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "media-item";
  item.dataset.url = entry.url;
  item.setAttribute("role", "listitem");
  item.title = entry.name;

  const thumb = document.createElement("div");
  thumb.className = "media-thumb";

  const kind = document.createElement("span");
  kind.className =
    entry.kind === "image" ? "media-thumb-kind media-thumb-kind--image" : "media-thumb-kind";
  kind.textContent = entry.kind === "image" ? "IMG" : "VID";
  thumb.appendChild(kind);

  if (entry.kind === "image") {
    const img = document.createElement("img");
    img.loading = "lazy";
    img.alt = entry.name;
    img.src = entry.url;
    thumb.appendChild(img);
  } else {
    const icon = document.createElement("span");
    icon.className = "media-thumb-icon";
    icon.textContent = "🎬";
    thumb.appendChild(icon);
    // Best-effort poster frame: swap the icon for a captured frame if one comes back.
    captureVideoPoster(entry.url).then((poster) => {
      if (!poster || !icon.isConnected) return;
      const img = document.createElement("img");
      img.alt = entry.name;
      img.src = poster;
      icon.replaceWith(img);
    });
  }

  const name = document.createElement("span");
  name.className = "media-name";
  name.textContent = entry.name;

  item.append(thumb, name);
  item.addEventListener("click", () => {
    setActiveMediaItem(entry.url);
    if (entry.kind === "image") {
      loadImageURL(entry.url, entry.name);
    } else {
      loadVideoURL(entry.url);
    }
    setStatus(`Loading ${entry.kind}: ${entry.name}`, "warning");
  });
  return item;
}

// Render the project media gallery from the /media folders. Drop-in files appear
// automatically (Vite watches the glob); clicking a tile loads it through the pipeline.
function renderMediaLibrary() {
  if (!mediaLibraryEl) return;
  const { videos, images } = getProjectMedia();
  mediaLibraryEl.textContent = "";

  if (!videos.length && !images.length) {
    const empty = document.createElement("p");
    empty.className = "media-library-empty";
    empty.innerHTML =
      "No media yet. Drop clips in <code>media/videos</code> or stills in <code>media/images</code> — they show up here automatically.";
    mediaLibraryEl.appendChild(empty);
    return;
  }

  const addGroup = (label, entries) => {
    if (!entries.length) return;
    const heading = document.createElement("p");
    heading.className = "media-group-label";
    heading.textContent = `${label} (${entries.length})`;
    mediaLibraryEl.appendChild(heading);
    entries.forEach((entry) => mediaLibraryEl.appendChild(buildMediaItem(entry)));
  };

  addGroup("Videos", videos);
  addGroup("Images", images);
}

// Dev hook: load a same-origin video URL through the normal video pipeline.
function loadVideoURL(url) {
  prepareMediaMode("video");
  clearImageSource();
  clearVideoObjectUrl();
  applyVideoSound();
  videoElement.loop = Boolean(loopVideoToggle?.checked);
  applyPlaybackSpeed();
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

function readStoredBool(key, defaultValue = true) {
  try {
    const stored = localStorage.getItem(key);
    if (stored === null) return defaultValue;
    return stored === "1";
  } catch {
    return defaultValue;
  }
}

function init() {
  if (swapHandsToggle) {
    try {
      // Default OFF: getAnatomicalHands() corrects panel labels for front-facing video.
      // Turn ON when MediaPipe hand labels need a source-level swap for the rig as well.
      swapHandsToggle.checked = localStorage.getItem(SWAP_HANDS_STORAGE_KEY) === "1";
    } catch {
      swapHandsToggle.checked = false;
    }
  }
  if (fullSkeletonJointLabelsToggle) {
    fullSkeletonJointLabelsToggle.checked = readStoredBool(FULL_SKELETON_LABELS_KEY, true);
    showFullSkeletonJointLabels = fullSkeletonJointLabelsToggle.checked;
  }
  if (riggedJointLabelsToggle) {
    riggedJointLabelsToggle.checked = readStoredBool(RIGGED_LABELS_KEY, true);
  }
  if (rigVariantSelect) {
    try {
      const stored = localStorage.getItem(RIG_VARIANT_KEY);
      if (stored && [...rigVariantSelect.options].some((opt) => opt.value === stored)) {
        rigVariantSelect.value = stored;
      }
    } catch {
      // ignore storage failures
    }
  }
  if (skeletonZoomInput) {
    const level = readStoredZoomLevel(SKELETON_ZOOM_KEY);
    skeletonZoomInput.value = String(level);
    skeletonZoom = zoomLevelToFactor(level);
    updateZoomLabel(skeletonZoomLabel, skeletonZoom);
  }
  if (rigZoomInput) {
    const level = readStoredZoomLevel(RIG_ZOOM_KEY);
    rigZoomInput.value = String(level);
    updateZoomLabel(rigZoomLabel, zoomLevelToFactor(level));
  }
  renderMediaLibrary();
  bindEvents();
  setupLandmarkPopups();
  applyPlaybackSpeed();
  syncSourceUI();
  refreshRawPanel();
  const rawPlayer = document.querySelector(".viz-card--raw .tile-player");
  const stageResizeObserver = new ResizeObserver(() => {
    syncVizPlayerLayout();
    if (getFrameSource()) {
      processCurrentFrame();
    } else {
      refreshRawPanel();
    }
  });
  if (rawPlayer) {
    stageResizeObserver.observe(rawPlayer);
  } else {
    stageResizeObserver.observe(canvasElement);
  }
  if (skeletonResizeObserver) skeletonResizeObserver.disconnect();
  skeletonResizeObserver = new ResizeObserver(() => {
    if (latestResults) updateKeypointsPanel();
  });
  [fullSkeletonCanvas, bodySkeletonCanvas, faceSkeletonCanvas, leftHandSkeletonCanvas, rightHandSkeletonCanvas].forEach(
    (canvas) => skeletonResizeObserver.observe(canvas)
  );
  window.__loadVideoURL = loadVideoURL;
  window.__loadImageURL = loadImageURL;
  window.__playVideo = playLoadedVideo;
  window.__processFrame = processCurrentFrame;
  window.__video = videoElement;
  window.__image = imageElement;
  window.__switchSource = switchSource;

  // Non-secure origins (e.g. http over Tailscale/LAN) can't use the webcam, but video and
  // image file modes work fine — so boot the app and only warn, don't bail out. If the
  // default source is the (unavailable) camera, switch to Video File so the user can load a clip.
  if (!window.isSecureContext && window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1") {
    setStatus("Camera needs HTTPS or localhost. Over this address, use Video File / Photo — they work normally.", "warning");
    if (sourceSelect.value === "camera") {
      sourceSelect.value = "video";
      syncSourceUI();
      refreshRawPanel();
    }
  }

  if (!hasMediaPipeGlobals()) {
    setStatus("MediaPipe did not load. Check your internet connection, then refresh.", "danger");
    return;
  }

  bootApp();
}

async function bootApp() {
  setStatus("Loading Mushy rig...", "warning");
  retryButton.disabled = true;

  let rigReady = false;
  try {
    await initRigHost();
    rigReady = true;
  } catch (error) {
    console.error(error);
    setStatus(`Mushy rig failed to load: ${error.message || "check console"}`, "danger");
  }

  setStatus("Loading MediaPipe... first run can take a few seconds.", "warning");
  setupModels();
  syncSourceUI();
  refreshRawPanel();
  syncVizPlayerLayout();
  setModelsLoaded(rigReady);
  if (rigReady) {
    setStatus("Ready. Click Start Camera or load an image/video file to begin.", "success");
  }
}

window.addEventListener("load", init);
