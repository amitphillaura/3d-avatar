import { mkdirSync, existsSync, unlinkSync, readdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { getDb } from "../db/index.js";
import { videoDir, DATA_ROOT } from "../lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = join(__dirname, "..");
const DETECT_PY = join(__dirname, "../worker/detect.py");
const TMP_DIR = join(DATA_ROOT, "detect_tmp");

// Prefer the project venv (created by `npm run backend:setup`), which has
// ultralytics installed; fall back to system python3. Mirrors lib/processor.js.
const PYTHON_BIN = existsSync(join(BACKEND_DIR, ".venv/bin/python3"))
  ? join(BACKEND_DIR, ".venv/bin/python3")
  : (process.env.DETECT_PYTHON || "python3");

function ensureTmpDir() {
  if (!existsSync(TMP_DIR)) mkdirSync(TMP_DIR, { recursive: true });
}

// ─── Persistent YOLO worker ───────────────────────────────────────────────────
// detect.py runs in a persistent loop: one process stays alive, model stays
// warm. Each request/response is a single newline-delimited JSON line.
let _worker = null;
let _workerBuf = "";
const _pending = []; // { resolve, reject, timer }

function getWorker() {
  if (_worker && !_worker.killed) return _worker;
  _worker = spawn(PYTHON_BIN, [DETECT_PY], { stdio: ["pipe", "pipe", "pipe"] });
  _workerBuf = "";
  _worker.stdout.on("data", (chunk) => {
    _workerBuf += chunk.toString();
    const lines = _workerBuf.split("\n");
    _workerBuf = lines.pop();
    for (const line of lines) {
      const waiter = _pending.shift();
      if (!waiter) continue;
      clearTimeout(waiter.timer);
      try { waiter.resolve(JSON.parse(line)); }
      catch { waiter.reject(new Error(`detect.py bad output: ${line}`)); }
    }
  });
  _worker.stderr.on("data", (c) => { /* model load noise — ignore */ });
  _worker.on("error", (err) => {
    _worker = null;
    for (const w of _pending.splice(0)) { clearTimeout(w.timer); w.reject(err); }
  });
  _worker.on("close", () => {
    _worker = null;
    for (const w of _pending.splice(0)) { clearTimeout(w.timer); w.reject(new Error("detect worker exited")); }
  });
  return _worker;
}

function runDetect(imagePath, confidence = 0.4) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const idx = _pending.findIndex(p => p.resolve === resolve);
      if (idx !== -1) _pending.splice(idx, 1);
      reject(new Error("detect.py timed out"));
    }, 30000);
    _pending.push({ resolve, reject, timer });
    const worker = getWorker();
    worker.stdin.write(JSON.stringify({ image_path: imagePath, confidence }) + "\n");
  });
}

/**
 * Save a base64 image to a temp file and return the path.
 */
function saveBase64Image(base64String) {
  ensureTmpDir();
  // Strip data URI prefix if present
  const data = base64String.replace(/^data:image\/\w+;base64,/, "");
  const buf = Buffer.from(data, "base64");
  const tmpPath = join(TMP_DIR, `${randomUUID()}.jpg`);
  writeFileSync(tmpPath, buf);
  return tmpPath;
}

function cleanupFile(path) {
  try { unlinkSync(path); } catch { /* ignore */ }
}

export function registerDetectionRoutes(app) {
  /**
   * POST /api/detect/image
   * Body: multipart with 'image' file OR JSON { imageBase64: string }
   */
  app.post("/api/detect/image", async (request, reply) => {
    const contentType = request.headers["content-type"] || "";
    let tmpPath = null;
    let confidence = 0.4;

    try {
      if (contentType.includes("multipart/form-data")) {
        const file = await request.file();
        if (!file) return reply.code(400).send({ error: "Missing image file" });
        const buf = await file.toBuffer();
        ensureTmpDir();
        tmpPath = join(TMP_DIR, `${randomUUID()}.jpg`);
        writeFileSync(tmpPath, buf);
        confidence = Number(file.fields?.confidence?.value ?? 0.4);
      } else {
        const body = request.body || {};
        if (!body.imageBase64) return reply.code(400).send({ error: "imageBase64 required" });
        confidence = Number(body.confidence ?? 0.4);
        tmpPath = saveBase64Image(body.imageBase64);
      }

      const result = await runDetect(tmpPath, confidence);
      return result;
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: err.message, detections: [] });
    } finally {
      if (tmpPath) cleanupFile(tmpPath);
    }
  });

  /**
   * POST /api/detect/video-frame
   * Body: { videoId: string, frameIndex: number, confidence?: number }
   */
  app.post("/api/detect/video-frame", async (request, reply) => {
    const { videoId, frameIndex, confidence = 0.4 } = request.body || {};
    if (!videoId) return reply.code(400).send({ error: "videoId required" });
    if (frameIndex == null) return reply.code(400).send({ error: "frameIndex required" });

    const framePath = join(videoDir(videoId), "frames", `frame_${frameIndex}.jpg`);
    if (!existsSync(framePath)) {
      return reply.code(404).send({ error: `Frame ${frameIndex} not found for video ${videoId}` });
    }

    try {
      const result = await runDetect(framePath, Number(confidence));
      return result;
    } catch (err) {
      request.log.error(err);
      return reply.code(500).send({ error: err.message, detections: [] });
    }
  });

  /**
   * POST /api/detect/auto-tag
   * Body: { videoId: string }
   * Samples frames across the video (every 30 frames), runs detection,
   * collects unique class names above 0.5 confidence, inserts as tags.
   */
  app.post("/api/detect/auto-tag", async (request, reply) => {
    const { videoId } = request.body || {};
    if (!videoId) return reply.code(400).send({ error: "videoId required" });

    const db = getDb();
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(videoId);
    if (!video) return reply.code(404).send({ error: "Video not found" });

    const framesDir = join(videoDir(videoId), "frames");
    if (!existsSync(framesDir)) {
      return reply.code(404).send({ error: "Frames directory not found — process the video first" });
    }

    // List frame files
    let frameFiles;
    try {
      frameFiles = readdirSync(framesDir)
        .filter(f => f.startsWith("frame_") && f.endsWith(".jpg"))
        .sort((a, b) => {
          const ni = n => parseInt(n.replace("frame_", "").replace(".jpg", ""), 10);
          return ni(a) - ni(b);
        });
    } catch {
      return reply.code(500).send({ error: "Could not read frames directory" });
    }

    if (!frameFiles.length) {
      return reply.code(404).send({ error: "No frames found" });
    }

    // Sample every 30 frames
    const SAMPLE_INTERVAL = 30;
    const sampled = frameFiles.filter((_, i) => i % SAMPLE_INTERVAL === 0);

    const CONFIDENCE_THRESHOLD = 0.5;
    const classSet = new Set();

    for (const fname of sampled) {
      const framePath = join(framesDir, fname);
      try {
        const result = await runDetect(framePath, CONFIDENCE_THRESHOLD);
        if (result.detections) {
          for (const d of result.detections) {
            if (d.confidence >= CONFIDENCE_THRESHOLD) {
              classSet.add(d.class);
            }
          }
        }
      } catch (err) {
        request.log.warn(`Detection failed for ${fname}: ${err.message}`);
      }
    }

    const tagsAdded = [];
    const insertTag = db.prepare(`
      INSERT OR IGNORE INTO video_tags (video_id, tag_type, tag_value, confidence, source)
      VALUES (?, ?, ?, ?, ?)
    `);

    for (const cls of classSet) {
      insertTag.run(videoId, "object", cls, CONFIDENCE_THRESHOLD, "object-detector");
      tagsAdded.push(cls);
    }

    return { videoId, tagsAdded };
  });
}
