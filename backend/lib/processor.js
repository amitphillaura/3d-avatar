import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { extname, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkeleton2d } from "./skeleton2d.js";
import { buildRig3d } from "./rig3d.js";
import {
  ensureVideoDir,
  processedLandmarksPath,
  rawLandmarksPath,
  PROJECT_ROOT,
  videoDir
} from "./paths.js";

const WORKER_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "../worker");
const BACKEND_DIR = resolve(WORKER_DIR, "..");
const PROCESS_SCRIPT = join(WORKER_DIR, "process_video.py");
const PYTHON_BIN = existsSync(join(BACKEND_DIR, ".venv/bin/python3"))
  ? join(BACKEND_DIR, ".venv/bin/python3")
  : "python3";
export const PIPELINE_VERSION = "poseSkeleton@v1";
export const TARGET_FPS = 30;

export function sha256File(path) {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash("sha256");
    createReadStream(path)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolvePromise(hash.digest("hex")));
  });
}

function hasBody(pose) {
  if (!pose?.length) return false;
  const core = [11, 12, 23, 24];
  return core.every((index) => (pose[index]?.visibility ?? 1) > 0.36);
}

function hasFace(face) {
  return Boolean(face?.length);
}

function hasHand(hand) {
  return Boolean(hand?.length && (hand[0]?.visibility ?? 1) > 0.2);
}

function detectionState(raw) {
  const body = hasBody(raw.pose);
  const face = hasFace(raw.face);
  const lh = hasHand(raw.left_hand);
  const rh = hasHand(raw.right_hand);
  if (body && face) return "full";
  if (body || face || lh || rh) return "partial";
  return "none";
}

export function enrichRawFrame(raw, { rigVariant, width, height }) {
  const skeleton = buildSkeleton2d(raw, { width, height });
  const rig = buildRig3d(raw, { variant: rigVariant, pipelineVersion: PIPELINE_VERSION });
  return {
    frame_index: raw.frame_index,
    timestamp_ms: raw.timestamp_ms,
    raw: {
      pose: raw.pose,
      face: raw.face,
      left_hand: raw.left_hand,
      right_hand: raw.right_hand
    },
    skeleton_2d: skeleton,
    rig,
    detection: {
      state: detectionState(raw),
      has_body: hasBody(raw.pose),
      has_face: hasFace(raw.face),
      has_left_hand: hasHand(raw.left_hand),
      has_right_hand: hasHand(raw.right_hand)
    }
  };
}

async function runPythonProcessor(videoPath, outputPath, fps = TARGET_FPS) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(PYTHON_BIN, [PROCESS_SCRIPT, "--video", videoPath, "--output", outputPath, "--fps", String(fps)], {
      cwd: PROJECT_ROOT,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      reject(new Error(`Failed to start python3 processor: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Processor exited with code ${code}`));
        return;
      }
      const lines = stdout.trim().split("\n").filter(Boolean);
      const metaLine = lines[lines.length - 1] || "{}";
      try {
        resolvePromise(JSON.parse(metaLine));
      } catch {
        resolvePromise({});
      }
    });
  });
}

export async function processVideoJob({
  db,
  videoId,
  sourcePath,
  rigVariant,
  trackingMode,
  width,
  height
}) {
  ensureVideoDir(videoId);
  const rawPath = rawLandmarksPath(videoId);
  const processedPath = processedLandmarksPath(videoId);

  db.prepare("UPDATE videos SET status = ?, error_message = NULL WHERE id = ?").run("processing", videoId);

  try {
    const meta = await runPythonProcessor(sourcePath, rawPath, TARGET_FPS);

    const insertFrame = db.prepare(`
      INSERT INTO frames (
        video_id, frame_index, timestamp_ms, detection_state,
        has_body, has_face, has_left_hand, has_right_hand
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.prepare("DELETE FROM frames WHERE video_id = ?").run(videoId);

    const processedStream = createWriteStream(processedPath, { encoding: "utf8" });
    let frameCount = 0;

    const tx = db.transaction((rows) => {
      rows.forEach((row) => insertFrame.run(
        videoId,
        row.frame_index,
        row.timestamp_ms,
        row.detection.state,
        row.detection.has_body ? 1 : 0,
        row.detection.has_face ? 1 : 0,
        row.detection.has_left_hand ? 1 : 0,
        row.detection.has_right_hand ? 1 : 0
      ));
    });

    const batch = [];
    const rl = createInterface({
      input: createReadStream(rawPath, { encoding: "utf8" }),
      crlfDelay: Infinity
    });

    for await (const line of rl) {
      if (!line.trim()) continue;
      const raw = JSON.parse(line);
      const enriched = enrichRawFrame(raw, {
        rigVariant,
        width: width || meta.width || 1280,
        height: height || meta.height || 720
      });
      processedStream.write(`${JSON.stringify(enriched)}\n`);
      batch.push(enriched);
      frameCount += 1;
      if (batch.length >= 100) {
        tx(batch.splice(0, batch.length));
      }
    }
    if (batch.length) tx(batch);
    processedStream.end();

    db.prepare(`
      UPDATE videos
      SET status = 'ready',
          frame_count = ?,
          duration_ms = ?,
          fps = ?,
          width = COALESCE(?, width),
          height = COALESCE(?, height),
          rig_variant = ?,
          tracking_mode = ?,
          pipeline_version = ?,
          processed_at = datetime('now'),
          error_message = NULL
      WHERE id = ?
    `).run(
      frameCount,
      meta.duration_ms ?? null,
      meta.fps ?? TARGET_FPS,
      meta.width ?? null,
      meta.height ?? null,
      rigVariant,
      trackingMode,
      PIPELINE_VERSION,
      videoId
    );

    return { frameCount, meta };
  } catch (error) {
    db.prepare("UPDATE videos SET status = 'failed', error_message = ? WHERE id = ?").run(
      error.message,
      videoId
    );
    throw error;
  }
}

export async function readProcessedFrames(videoId, { from = 0, to = Infinity } = {}) {
  const path = processedLandmarksPath(videoId);
  const frames = [];
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.frame_index < from) continue;
    if (frame.frame_index > to) break;
    frames.push(frame);
  }
  return frames;
}

export function saveUploadedVideo(buffer, videoId, originalName) {
  ensureVideoDir(videoId);
  const ext = extname(originalName || ".mp4") || ".mp4";
  const target = join(videoDir(videoId), `source${ext}`);
  writeFileSync(target, buffer);
  return target;
}

export function newVideoId() {
  return randomUUID();
}

export function readFrameByIndex(videoId, frameIndex) {
  const path = processedLandmarksPath(videoId);
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines) {
    if (!line.trim()) continue;
    const frame = JSON.parse(line);
    if (frame.frame_index === frameIndex) return frame;
  }
  return null;
}
