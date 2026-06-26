/**
 * Object Detection Tool
 * Sends frames to /api/detect/image (base64 JPEG) and draws bounding boxes.
 */

const API_BASE = "http://127.0.0.1:5190";
const SAMPLE_INTERVAL_MS = 500;

// --- Color per class (hash class name → HSL hue) ---
function classHue(className) {
  let h = 0;
  for (let i = 0; i < className.length; i++) {
    h = (h * 31 + className.charCodeAt(i)) & 0xffffff;
  }
  return h % 360;
}

function classColor(className) {
  return `hsl(${classHue(className)}, 90%, 55%)`;
}

// --- Send a canvas frame to the API ---
async function detectFrame(canvas, confidence = 0.4) {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.8);
  const base64 = dataUrl.split(",")[1];
  const resp = await fetch(`${API_BASE}/api/detect/image`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageBase64: base64, confidence })
  });
  if (!resp.ok) throw new Error(`API ${resp.status}`);
  return resp.json();
}

// --- Draw detections on a canvas overlay ---
function drawDetections(canvas, detections, videoEl) {
  const ctx = canvas.getContext("2d");
  // Sync canvas size to displayed video size
  const rect = videoEl.getBoundingClientRect();
  if (canvas.width !== rect.width || canvas.height !== rect.height) {
    canvas.width = rect.width;
    canvas.height = rect.height;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const d of detections) {
    const { x, y, w, h } = d.box;
    const px = x * canvas.width;
    const py = y * canvas.height;
    const pw = w * canvas.width;
    const ph = h * canvas.height;
    const color = classColor(d.class);

    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.strokeRect(px, py, pw, ph);

    // Label background
    const label = `${d.class} ${(d.confidence * 100).toFixed(0)}%`;
    ctx.font = "bold 12px Inter, sans-serif";
    const textW = ctx.measureText(label).width + 8;
    const textH = 18;
    ctx.fillStyle = color;
    ctx.fillRect(px, py - textH, textW, textH);
    ctx.fillStyle = "#000";
    ctx.fillText(label, px + 4, py - 4);
  }
}

// --- Capture a frame from a video element to an offscreen canvas ---
function captureFrame(videoEl) {
  const c = document.createElement("canvas");
  c.width = videoEl.videoWidth || 640;
  c.height = videoEl.videoHeight || 480;
  c.getContext("2d").drawImage(videoEl, 0, 0, c.width, c.height);
  return c;
}

// ============================================================
// Live / Multi mode (webcam)
// ============================================================
function makeCameraMode({ videoId, canvasId, startBtnId, stopBtnId, confidenceId, confidenceValueId, statusId }) {
  const videoEl = document.getElementById(videoId);
  const canvas = document.getElementById(canvasId);
  const startBtn = document.getElementById(startBtnId);
  const stopBtn = document.getElementById(stopBtnId);
  const confidenceSlider = document.getElementById(confidenceId);
  const confidenceOutput = document.getElementById(confidenceValueId);
  const statusEl = document.getElementById(statusId);

  let stream = null;
  let timer = null;
  let running = false;

  confidenceSlider.addEventListener("input", () => {
    confidenceOutput.value = Number(confidenceSlider.value).toFixed(2);
  });

  startBtn.addEventListener("click", async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: true });
      videoEl.srcObject = stream;
      await videoEl.play();
      startBtn.disabled = true;
      stopBtn.disabled = false;
      running = true;
      statusEl.textContent = "Running…";
      scheduleDetect();
    } catch (err) {
      statusEl.textContent = `Camera error: ${err.message}`;
    }
  });

  stopBtn.addEventListener("click", () => {
    stop();
  });

  function stop() {
    running = false;
    clearTimeout(timer);
    if (stream) {
      stream.getTracks().forEach(t => t.stop());
      stream = null;
    }
    videoEl.srcObject = null;
    const ctx = canvas.getContext("2d");
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    startBtn.disabled = false;
    stopBtn.disabled = true;
    statusEl.textContent = "Idle";
  }

  async function scheduleDetect() {
    if (!running) return;
    const start = Date.now();
    try {
      if (videoEl.readyState >= 2) {
        const frame = captureFrame(videoEl);
        const confidence = Number(confidenceSlider.value);
        const result = await detectFrame(frame, confidence);
        if (result.detections) {
          drawDetections(canvas, result.detections, videoEl);
          statusEl.textContent = `${result.detections.length} object(s) detected`;
        }
      }
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
    const elapsed = Date.now() - start;
    const delay = Math.max(0, SAMPLE_INTERVAL_MS - elapsed);
    if (running) timer = setTimeout(scheduleDetect, delay);
  }
}

// ============================================================
// Video file mode
// ============================================================
function makeVideoMode() {
  const videoEl = document.getElementById("detVideoEl");
  const canvas = document.getElementById("videoCanvas");
  const fileInput = document.getElementById("detVideoFile");
  const confidenceSlider = document.getElementById("videoConfidence");
  const confidenceOutput = document.getElementById("videoConfidenceValue");
  const statusEl = document.getElementById("videoStatus");

  let timer = null;
  let active = false;

  confidenceSlider.addEventListener("input", () => {
    confidenceOutput.value = Number(confidenceSlider.value).toFixed(2);
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    videoEl.src = url;
    statusEl.textContent = "Video loaded — press play to detect";
    active = false;
    clearTimeout(timer);
  });

  videoEl.addEventListener("play", () => {
    active = true;
    scheduleDetect();
  });

  videoEl.addEventListener("pause", () => {
    active = false;
    clearTimeout(timer);
    // Run one detection on the paused frame
    runOnce();
  });

  videoEl.addEventListener("ended", () => {
    active = false;
    clearTimeout(timer);
    statusEl.textContent = "Video ended";
  });

  videoEl.addEventListener("seeked", () => {
    if (!active) runOnce();
  });

  async function runOnce() {
    if (videoEl.readyState < 2) return;
    try {
      const frame = captureFrame(videoEl);
      const confidence = Number(confidenceSlider.value);
      const result = await detectFrame(frame, confidence);
      if (result.detections) {
        drawDetections(canvas, result.detections, videoEl);
        statusEl.textContent = `${result.detections.length} object(s) detected`;
      }
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
  }

  async function scheduleDetect() {
    if (!active) return;
    const start = Date.now();
    try {
      if (videoEl.readyState >= 2) {
        const frame = captureFrame(videoEl);
        const confidence = Number(confidenceSlider.value);
        const result = await detectFrame(frame, confidence);
        if (result.detections) {
          drawDetections(canvas, result.detections, videoEl);
          statusEl.textContent = `${result.detections.length} object(s) detected`;
        }
      }
    } catch (err) {
      statusEl.textContent = `Error: ${err.message}`;
    }
    const elapsed = Date.now() - start;
    const delay = Math.max(0, SAMPLE_INTERVAL_MS - elapsed);
    if (active) timer = setTimeout(scheduleDetect, delay);
  }
}

// ============================================================
// Tab switching
// ============================================================
function initTabs() {
  const tabs = document.querySelectorAll("#view-object-detection .detection-tab");
  const panels = document.querySelectorAll("#view-object-detection .detection-panel");

  tabs.forEach(tab => {
    tab.addEventListener("click", () => {
      const target = tab.dataset.tab;
      tabs.forEach(t => {
        t.classList.toggle("detection-tab--active", t.dataset.tab === target);
        t.setAttribute("aria-selected", t.dataset.tab === target ? "true" : "false");
      });
      panels.forEach(p => {
        p.hidden = p.id !== `panel-${target}`;
      });
    });
  });
}

// ============================================================
// View toggle (launcher button ↔ back button)
// ============================================================
function initViewToggle() {
  const view = document.getElementById("view-object-detection");
  const launcher = document.getElementById("openObjectDetection");
  const backBtn = document.getElementById("detectionBack");

  launcher.addEventListener("click", () => {
    view.hidden = false;
    launcher.hidden = true;
  });

  backBtn.addEventListener("click", () => {
    view.hidden = true;
    launcher.hidden = false;
  });
}

// ============================================================
// Entry point
// ============================================================
export function initObjectDetection() {
  initTabs();
  initViewToggle();

  makeCameraMode({
    videoId: "liveVideo",
    canvasId: "liveCanvas",
    startBtnId: "liveStart",
    stopBtnId: "liveStop",
    confidenceId: "liveConfidence",
    confidenceValueId: "liveConfidenceValue",
    statusId: "liveStatus"
  });

  makeCameraMode({
    videoId: "multiVideo",
    canvasId: "multiCanvas",
    startBtnId: "multiStart",
    stopBtnId: "multiStop",
    confidenceId: "multiConfidence",
    confidenceValueId: "multiConfidenceValue",
    statusId: "multiStatus"
  });

  makeVideoMode();
}

// Auto-init when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initObjectDetection);
} else {
  initObjectDetection();
}
