import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, existsSync, unlinkSync, rmSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { extname, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildSkeleton2d } from "./skeleton2d.js";
import { buildRig3d } from "./rig3d.js";
import { assignAnatomicalHands } from "../../src/handAssignment.js";
import {
  ensureVideoDir,
  matrixPath,
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
export const MAX_FRAME_RANGE = 300;
export const MAX_EXPORT_FRAMES = 500;

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
  const { left, right } = assignAnatomicalHands(raw.pose, raw.left_hand, raw.right_hand);
  const normalized = {
    ...raw,
    left_hand: left,
    right_hand: right
  };
  const skeleton = buildSkeleton2d(normalized, { width, height });
  const rig = buildRig3d(normalized, { variant: rigVariant, pipelineVersion: PIPELINE_VERSION });
  return {
    frame_index: raw.frame_index,
    timestamp_ms: raw.timestamp_ms,
    raw: {
      pose: raw.pose,
      face: raw.face,
      left_hand: left,
      right_hand: right
    },
    skeleton_2d: skeleton,
    rig,
    detection: {
      state: detectionState(normalized),
      has_body: hasBody(raw.pose),
      has_face: hasFace(raw.face),
      has_left_hand: hasHand(left),
      has_right_hand: hasHand(right)
    }
  };
}

export function invalidateVideoDerivatives(db, videoId) {
  const segments = db.prepare("SELECT id FROM segments WHERE video_id = ?").all(videoId);
  for (const segment of segments) {
    const path = matrixPath(videoId, segment.id);
    if (existsSync(path)) unlinkSync(path);
  }
  db.prepare(`
    UPDATE segments
    SET matrix_status = 'none', updated_at = datetime('now')
    WHERE video_id = ?
  `).run(videoId);
}

function parseJsonLine(line, context) {
  try {
    return JSON.parse(line);
  } catch (error) {
    throw new Error(`${context}: invalid JSONL (${error.message})`);
  }
}

/** Remove landmark files and frame rows; optionally invalidate segment matrices. */
export function discardProcessedLandmarks(db, videoId, { invalidateMatrices = false } = {}) {
  for (const path of [processedLandmarksPath(videoId), rawLandmarksPath(videoId)]) {
    if (existsSync(path)) unlinkSync(path);
  }
  db.prepare("DELETE FROM frames WHERE video_id = ?").run(videoId);
  if (invalidateMatrices) invalidateVideoDerivatives(db, videoId);
}

/** Drop segments whose frame range no longer fits the processed clip. */
export function pruneOutOfRangeSegments(db, videoId, frameCount) {
  if (!frameCount) return;
  const maxIndex = frameCount - 1;
  const stale = db.prepare(`
    SELECT id FROM segments
    WHERE video_id = ? AND (start_frame > ? OR end_frame > ?)
  `).all(videoId, maxIndex, maxIndex);
  for (const segment of stale) {
    const path = matrixPath(videoId, segment.id);
    if (existsSync(path)) unlinkSync(path);
  }
  db.prepare(`
    DELETE FROM segments
    WHERE video_id = ? AND (start_frame > ? OR end_frame > ?)
  `).run(videoId, maxIndex, maxIndex);
}

export function recoverStaleProcessing(db) {
  const stuck = db.prepare("SELECT id FROM videos WHERE status = 'processing'").all();
  if (!stuck.length) return;
  for (const row of stuck) {
    discardProcessedLandmarks(db, row.id, { invalidateMatrices: true });
  }
  db.prepare(`
    UPDATE videos
    SET status = 'uploaded', error_message = 'Processing interrupted (server restart)'
    WHERE status = 'processing'
  `).run();
  console.log(`Recovered ${stuck.length} video(s) stuck in processing`);
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

  invalidateVideoDerivatives(db, videoId);
  discardProcessedLandmarks(db, videoId);
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
      const raw = parseJsonLine(line, rawPath);
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

    pruneOutOfRangeSegments(db, videoId, frameCount);

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
    discardProcessedLandmarks(db, videoId, { invalidateMatrices: true });
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
    const frame = parseJsonLine(line, path);
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
  return new Promise((resolvePromise, reject) => {
    const path = processedLandmarksPath(videoId);
    if (!existsSync(path)) {
      resolvePromise(null);
      return;
    }

    let resolved = false;
    const rl = createInterface({
      input: createReadStream(path, { encoding: "utf8" }),
      crlfDelay: Infinity
    });

    rl.on("line", (line) => {
      if (!line.trim()) return;
      let frame;
      try {
        frame = parseJsonLine(line, path);
      } catch (error) {
        resolved = true;
        rl.close();
        reject(error);
        return;
      }
      if (frame.frame_index === frameIndex) {
        resolved = true;
        rl.close();
        resolvePromise(frame);
      } else if (frame.frame_index > frameIndex) {
        resolved = true;
        rl.close();
        resolvePromise(null);
      }
    });
    rl.on("close", () => {
      if (!resolved) resolvePromise(null);
    });
    rl.on("error", reject);
  });
}

export function deleteVideoAssets(videoId) {
  const dir = videoDir(videoId);
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
}
