import { createReadStream, readFileSync, rmSync } from "node:fs";
import { extname } from "node:path";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { getDb } from "../db/index.js";
import { buildMotionMatrix, scoreSegmentSearch } from "../lib/matrix.js";
import {
  matrixPath,
  videoDir,
  ensureVideoDir
} from "../lib/paths.js";
import {
  deleteVideoAssets,
  MAX_EXPORT_FRAMES,
  MAX_FRAME_RANGE,
  processVideoJob,
  readFrameByIndex,
  readProcessedFrames,
  saveUploadedVideo,
  sha256File,
  TARGET_FPS,
  newVideoId
} from "../lib/processor.js";
import { validateSegmentRange } from "../lib/segments.js";

const processing = new Set();

function serializeSegment(row) {
  if (!row) return null;
  return {
    ...row,
    approved: Boolean(row.approved)
  };
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

function clampFrameRange(video, fromRaw, toRaw) {
  const maxIndex = Math.max(0, (video.frame_count || 0) - 1);
  if (video.frame_count === 0) {
    return { error: "Video has no processed frames" };
  }
  const from = Math.max(0, Math.min(maxIndex, Number(fromRaw ?? 0)));
  const to = Math.max(from, Math.min(maxIndex, Number(toRaw ?? maxIndex)));
  if (!Number.isFinite(from) || !Number.isFinite(to)) {
    return { error: "Invalid frame range" };
  }
  if (to - from + 1 > MAX_FRAME_RANGE) {
    return { error: `Frame range too large (max ${MAX_FRAME_RANGE})` };
  }
  return { from, to, maxIndex };
}

function validateSegmentRangeForVideo(video, startFrame, endFrame) {
  return validateSegmentRange(video.frame_count, startFrame, endFrame);
}

function sourceContentType(sourcePath) {
  const ext = extname(sourcePath || "").toLowerCase();
  const types = {
    ".mp4": "video/mp4",
    ".webm": "video/webm",
    ".mov": "video/quicktime",
    ".mkv": "video/x-matroska",
    ".m4v": "video/x-mp4"
  };
  return types[ext] || "application/octet-stream";
}

export function registerVideoRoutes(app) {
  app.get("/api/health", async () => ({ ok: true, service: "motion-library" }));

  app.get("/api/queue", async () => {
    const db = getDb();
    // Return all videos that are not in a terminal-done state, plus recently-ready ones
    const rows = db.prepare(`
      SELECT id, filename, status, created_at, updated_at
      FROM videos
      WHERE status IN ('uploaded', 'processing', 'failed', 'ready')
      ORDER BY created_at DESC
      LIMIT 50
    `).all();
    const jobs = rows.map(v => ({
      id: v.id,
      filename: v.filename,
      status: v.status,
      progress: v.status === "processing" ? null : v.status === "ready" ? 100 : null,
      createdAt: v.created_at,
      updatedAt: v.updated_at
    }));
    return { jobs };
  });

  app.get("/api/videos", async () => {
    const db = getDb();
    const rows = db.prepare("SELECT * FROM videos ORDER BY created_at DESC").all();
    return { videos: rows };
  });

  app.get("/api/videos/:id", async (request, reply) => {
    const db = getDb();
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(request.params.id);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    const tags = db.prepare("SELECT * FROM video_tags WHERE video_id = ? ORDER BY id DESC").all(video.id);
    const segments = db.prepare("SELECT * FROM segments WHERE video_id = ? ORDER BY start_frame ASC").all(video.id);
    const frameStats = db.prepare(`
      SELECT detection_state, COUNT(*) AS count
      FROM frames WHERE video_id = ?
      GROUP BY detection_state
    `).all(video.id);
    return { video, tags, segments, frame_stats: frameStats };
  });

  app.post("/api/videos", async (request, reply) => {
    const file = await request.file();
    if (!file) return reply.code(400).send({ error: "Missing video file" });

    const fields = file.fields || {};
    const rigVariant = fields.rig_variant?.value || "mushy";
    const trackingMode = fields.tracking_mode?.value || "both";
    const buffer = await file.toBuffer();
    const videoId = newVideoId();
    const sourcePath = saveUploadedVideo(buffer, videoId, file.filename);
    const sha256 = await sha256File(sourcePath);
    const db = getDb();
    const existing = db.prepare("SELECT id FROM videos WHERE sha256 = ?").get(sha256);
    if (existing) {
      rmSync(videoDir(videoId), { recursive: true, force: true });
      return reply.code(409).send({ error: "Video already imported", video_id: existing.id });
    }

    db.prepare(`
      INSERT INTO videos (id, filename, sha256, source_path, rig_variant, tracking_mode, status)
      VALUES (?, ?, ?, ?, ?, ?, 'uploaded')
    `).run(videoId, file.filename, sha256, sourcePath, rigVariant, trackingMode);

    return reply.code(201).send({ video_id: videoId, filename: file.filename, status: "uploaded" });
  });

  app.delete("/api/videos/:id", async (request, reply) => {
    const db = getDb();
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(request.params.id);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    if (processing.has(video.id)) {
      return reply.code(409).send({ error: "Video is processing" });
    }

    db.prepare("DELETE FROM videos WHERE id = ?").run(video.id);
    deleteVideoAssets(video.id);
    return reply.code(204).send();
  });

  app.post("/api/videos/:id/process", async (request, reply) => {
    const db = getDb();
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(request.params.id);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    if (processing.has(video.id)) {
      return reply.code(409).send({ error: "Video is already processing" });
    }

    processing.add(video.id);
    processVideoJob({
      db,
      videoId: video.id,
      sourcePath: video.source_path,
      rigVariant: video.rig_variant,
      trackingMode: video.tracking_mode,
      width: video.width,
      height: video.height
    })
      .catch((error) => {
        console.error(`Processing failed for ${video.id}:`, error.message);
      })
      .finally(() => {
        processing.delete(video.id);
      });

    return reply.code(202).send({ video_id: video.id, status: "processing" });
  });

  app.get("/api/videos/:id/frames", async (request, reply) => {
    const db = getDb();
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(request.params.id);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    if (video.status !== "ready") return reply.code(409).send({ error: "Video not processed yet" });

    const range = clampFrameRange(video, request.query.from, request.query.to);
    if (range.error) return reply.code(400).send({ error: range.error });

    const frames = await readProcessedFrames(video.id, { from: range.from, to: range.to });
    return { video_id: video.id, from: range.from, to: range.to, frames };
  });

  app.get("/api/videos/:id/frames/:index", async (request, reply) => {
    const db = getDb();
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(request.params.id);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    if (video.status !== "ready") return reply.code(409).send({ error: "Video not processed yet" });

    const frameIndex = Number(request.params.index);
    const frame = await readFrameByIndex(video.id, frameIndex);
    if (!frame) return reply.code(404).send({ error: "Frame not found" });
    return { video_id: video.id, frame };
  });

  app.get("/api/videos/:id/tags", async (request, reply) => {
    const db = getDb();
    const video = db.prepare("SELECT id FROM videos WHERE id = ?").get(request.params.id);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    const tags = db.prepare("SELECT * FROM video_tags WHERE video_id = ? ORDER BY id DESC").all(video.id);
    return { tags };
  });

  app.post("/api/videos/:id/tags", async (request, reply) => {
    const db = getDb();
    const video = db.prepare("SELECT id FROM videos WHERE id = ?").get(request.params.id);
    if (!video) return reply.code(404).send({ error: "Video not found" });

    const { tag_type: tagType, tag_value: tagValue, confidence = 1, source = "human" } = request.body || {};
    if (!tagType || !tagValue) return reply.code(400).send({ error: "tag_type and tag_value required" });

    const result = db.prepare(`
      INSERT INTO video_tags (video_id, tag_type, tag_value, confidence, source)
      VALUES (?, ?, ?, ?, ?)
    `).run(video.id, tagType, tagValue, confidence, source);

    return reply.code(201).send({
      id: result.lastInsertRowid,
      video_id: video.id,
      tag_type: tagType,
      tag_value: tagValue
    });
  });

  app.get("/api/videos/:id/source", async (request, reply) => {
    const db = getDb();
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(request.params.id);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    reply.header("Content-Type", sourceContentType(video.source_path));
    return reply.send(createReadStream(video.source_path));
  });
}

export function registerSegmentRoutes(app) {
  app.get("/api/segments", async (request) => {
    const db = getDb();
    const q = String(request.query.q || "").trim();
    const rows = db.prepare(`
      SELECT s.*, v.filename, v.rig_variant
      FROM segments s
      JOIN videos v ON v.id = s.video_id
      ORDER BY s.updated_at DESC
    `).all();

    const tagStmt = db.prepare(`
      SELECT tag_type, tag_value FROM video_tags WHERE video_id = ? ORDER BY id DESC
    `);

    const segments = q
      ? rows
          .map((segment) => {
            const tags = tagStmt.all(segment.video_id);
            const matrix =
              segment.matrix_status === "ready"
                ? readJsonFile(matrixPath(segment.video_id, segment.id))
                : null;
            return {
              segment,
              score: scoreSegmentSearch({ segment, tags, matrix, query: q })
            };
          })
          .filter((entry) => entry.score > 0)
          .sort((a, b) => b.score - a.score)
          .map((entry) => entry.segment)
      : rows;

    return { segments: segments.map(serializeSegment) };
  });

  app.post("/api/videos/:id/segments", async (request, reply) => {
    const db = getDb();
    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(request.params.id);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    if (video.status !== "ready") return reply.code(409).send({ error: "Video not processed yet" });

    const body = request.body || {};
    const startFrame = Number(body.start_frame);
    const endFrame = Number(body.end_frame);
    const rangeError = validateSegmentRangeForVideo(video, startFrame, endFrame);
    if (rangeError) return reply.code(400).send({ error: rangeError });

    const segmentId = randomUUID();
    const startMs = (startFrame / TARGET_FPS) * 1000;
    const endMs = (endFrame / TARGET_FPS) * 1000;

    db.prepare(`
      INSERT INTO segments (
        id, video_id, start_frame, end_frame, start_ms, end_ms,
        label, description, motion_type, word_prompt, approved
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      segmentId,
      video.id,
      startFrame,
      endFrame,
      startMs,
      endMs,
      body.label || null,
      body.description || null,
      body.motion_type || null,
      body.word_prompt || null,
      body.approved ? 1 : 0
    );

    const segment = db.prepare("SELECT * FROM segments WHERE id = ?").get(segmentId);
    return reply.code(201).send({ segment: serializeSegment(segment) });
  });

  app.patch("/api/segments/:id", async (request, reply) => {
    const db = getDb();
    const segment = db.prepare("SELECT * FROM segments WHERE id = ?").get(request.params.id);
    if (!segment) return reply.code(404).send({ error: "Segment not found" });

    const body = request.body || {};
    db.prepare(`
      UPDATE segments SET
        label = COALESCE(?, label),
        description = COALESCE(?, description),
        motion_type = COALESCE(?, motion_type),
        word_prompt = COALESCE(?, word_prompt),
        approved = COALESCE(?, approved),
        updated_at = datetime('now')
      WHERE id = ?
    `).run(
      body.label ?? null,
      body.description ?? null,
      body.motion_type ?? null,
      body.word_prompt ?? null,
      body.approved === undefined ? null : body.approved ? 1 : 0,
      segment.id
    );

    const updated = db.prepare("SELECT * FROM segments WHERE id = ?").get(segment.id);
    return { segment: serializeSegment(updated) };
  });

  app.post("/api/segments/:id/build-matrix", async (request, reply) => {
    const db = getDb();
    const segment = db.prepare("SELECT * FROM segments WHERE id = ?").get(request.params.id);
    if (!segment) return reply.code(404).send({ error: "Segment not found" });

    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(segment.video_id);
    if (!video || video.status !== "ready") {
      return reply.code(409).send({ error: "Video not ready" });
    }

    const rangeError = validateSegmentRangeForVideo(video, segment.start_frame, segment.end_frame);
    if (rangeError) return reply.code(400).send({ error: rangeError });

    const frames = await readProcessedFrames(video.id, {
      from: segment.start_frame,
      to: segment.end_frame
    });
    if (!frames.length) return reply.code(400).send({ error: "No frames in segment" });

    const matrix = buildMotionMatrix(frames, {
      segmentId: segment.id,
      wordPrompt: segment.word_prompt,
      label: segment.label
    });

    if (!matrix.frame_count) {
      return reply.code(400).send({ error: "Matrix has no valid body frames" });
    }

    ensureVideoDir(video.id);
    writeFileSync(matrixPath(video.id, segment.id), JSON.stringify(matrix, null, 2));
    db.prepare(`
      UPDATE segments SET matrix_status = 'ready', updated_at = datetime('now') WHERE id = ?
    `).run(segment.id);

    return {
      segment_id: segment.id,
      matrix_status: "ready",
      frame_count: matrix.frame_count,
      vector_dim: matrix.vector_dim
    };
  });

  app.get("/api/segments/:id/matrix", async (request, reply) => {
    const db = getDb();
    const segment = db.prepare("SELECT * FROM segments WHERE id = ?").get(request.params.id);
    if (!segment) return reply.code(404).send({ error: "Segment not found" });
    if (segment.matrix_status !== "ready") {
      return reply.code(409).send({ error: "Matrix not built yet" });
    }

    const matrix = readJsonFile(matrixPath(segment.video_id, segment.id));
    if (!matrix) return reply.code(404).send({ error: "Matrix file missing" });
    return matrix;
  });

  app.get("/api/segments/:id/export", async (request, reply) => {
    const db = getDb();
    const segment = db.prepare("SELECT * FROM segments WHERE id = ?").get(request.params.id);
    if (!segment) return reply.code(404).send({ error: "Segment not found" });

    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(segment.video_id);
    if (!video) return reply.code(404).send({ error: "Video not found" });
    if (video.status !== "ready") return reply.code(409).send({ error: "Video not processed yet" });

    const rangeError = validateSegmentRangeForVideo(video, segment.start_frame, segment.end_frame);
    if (rangeError) return reply.code(400).send({ error: rangeError });

    const frames = await readProcessedFrames(video.id, {
      from: segment.start_frame,
      to: segment.end_frame
    });

    return {
      segment: serializeSegment(segment),
      video: {
        id: video.id,
        filename: video.filename,
        rig_variant: video.rig_variant,
        width: video.width || null,
        height: video.height || null
      },
      fps: TARGET_FPS,
      frames
    };
  });

  app.get("/api/search/motion", async (request) => {
    const q = String(request.query.q || "").trim();
    const db = getDb();
    const segments = db.prepare(`
      SELECT s.*, v.filename, v.rig_variant
      FROM segments s
      JOIN videos v ON v.id = s.video_id
      WHERE s.matrix_status = 'ready'
      ORDER BY s.updated_at DESC
    `).all();

    const tagStmt = db.prepare(`
      SELECT tag_type, tag_value FROM video_tags WHERE video_id = ? ORDER BY id DESC
    `);

    const results = segments
      .map((segment) => {
        let score = 0;
        if (q) {
          const tags = tagStmt.all(segment.video_id);
          const matrix = readJsonFile(matrixPath(segment.video_id, segment.id));
          score = scoreSegmentSearch({ segment, tags, matrix, query: q });
        }
        return { segment: serializeSegment(segment), score };
      })
      .filter((entry) => !q || entry.score > 0)
      .sort((a, b) => b.score - a.score);

    return { query: q, results };
  });
}
