/**
 * animal.js — Backend route for animal pose processing.
 *
 * POST /api/videos/:id/process-animal
 *   Kicks off process_video_animal.py on the stored video source file.
 *   Results are written to data/videos/{id}/animal_landmarks.json.
 *   Video status is updated in the DB.
 *
 * GET /api/videos/:id/animal-landmarks
 *   Returns the stored animal_landmarks.json (or 404 if not yet processed).
 */

import { existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { getDb } from "../db/index.js";
import { videoDir, ensureVideoDir, videoSourcePath } from "../lib/paths.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ANIMAL_SCRIPT = join(__dirname, "../worker/process_video_animal.py");
const PYTHON_BIN = process.env.PYTHON_BIN || "python3";

function animalLandmarksPath(videoId) {
  return join(videoDir(videoId), "animal_landmarks.json");
}

/**
 * Spawn process_video_animal.py and wait for completion.
 * Resolves with parsed summary meta; rejects on non-zero exit.
 */
function runAnimalProcessor(sourcePath, outputPath, fps = 15) {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [
      ANIMAL_SCRIPT,
      "--video", sourcePath,
      "--output", outputPath,
      "--fps", String(fps)
    ], {
      cwd: join(__dirname, "../.."),
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });

    child.on("error", (err) => {
      reject(new Error(`Failed to start animal processor: ${err.message}`));
    });

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || stdout.trim() || `Animal processor exited with code ${code}`));
        return;
      }
      // Last non-PROGRESS JSON line is the summary
      const lines = stdout.trim().split("\n").filter((l) => l.trim() && !l.startsWith("PROGRESS:"));
      const lastLine = lines[lines.length - 1] || "{}";
      try {
        resolve(JSON.parse(lastLine));
      } catch {
        resolve({});
      }
    });
  });
}

export function registerAnimalRoutes(app) {
  /**
   * POST /api/videos/:id/process-animal
   * Body (optional JSON): { fps: number }
   */
  app.post("/api/videos/:id/process-animal", async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const video = db.prepare("SELECT * FROM videos WHERE id = ?").get(id);
    if (!video) {
      return reply.code(404).send({ error: "Video not found" });
    }

    // Find source file (video.filename column may store the original name)
    const sourceDir = videoDir(id);
    let sourcePath = videoSourcePath(id, "source");
    if (!existsSync(sourcePath)) {
      // Try common extensions
      for (const ext of ["mp4", "mov", "avi", "webm", "mkv"]) {
        const candidate = join(sourceDir, `source.${ext}`);
        if (existsSync(candidate)) { sourcePath = candidate; break; }
      }
    }
    if (!existsSync(sourcePath)) {
      return reply.code(422).send({ error: "Source video file not found on disk" });
    }

    const fps = Number(request.body?.fps) || 15;
    ensureVideoDir(id);
    const outputPath = animalLandmarksPath(id);

    db.prepare("UPDATE videos SET status = 'processing', error_message = NULL WHERE id = ?").run(id);

    // Run in background so the HTTP response returns immediately
    runAnimalProcessor(sourcePath, outputPath, fps)
      .then((meta) => {
        db.prepare(`
          UPDATE videos
          SET status = 'ready',
              error_message = NULL
          WHERE id = ?
        `).run(id);
        app.log.info({ videoId: id, meta }, "Animal processing complete");
      })
      .catch((err) => {
        db.prepare("UPDATE videos SET status = 'failed', error_message = ? WHERE id = ?")
          .run(err.message, id);
        app.log.error({ videoId: id, err: err.message }, "Animal processing failed");
      });

    return reply.code(202).send({ status: "processing", videoId: id, outputPath });
  });

  /**
   * GET /api/videos/:id/animal-landmarks
   * Returns the raw JSON written by process_video_animal.py.
   */
  app.get("/api/videos/:id/animal-landmarks", async (request, reply) => {
    const { id } = request.params;
    const db = getDb();

    const video = db.prepare("SELECT id FROM videos WHERE id = ?").get(id);
    if (!video) {
      return reply.code(404).send({ error: "Video not found" });
    }

    const landmarksPath = animalLandmarksPath(id);
    if (!existsSync(landmarksPath)) {
      return reply.code(404).send({ error: "Animal landmarks not yet generated. Run process-animal first." });
    }

    try {
      const data = JSON.parse(readFileSync(landmarksPath, "utf8"));
      return reply.send(data);
    } catch (err) {
      return reply.code(500).send({ error: `Failed to read landmarks: ${err.message}` });
    }
  });
}
