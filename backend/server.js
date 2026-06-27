import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { recoverStaleProcessing } from "./lib/processor.js";
import { registerSegmentRoutes, registerVideoRoutes } from "./routes/index.js";
import { registerFileRoutes } from "./routes/files.js";
import { registerDetectionRoutes } from "./routes/detection.js";
import { registerAnimalRoutes } from "./routes/animal.js";
import { registerMeshRoutes } from "./routes/mesh.js";
import { ensureDataDirs, ensureMeshDirs } from "./lib/paths.js";
import { recoverStaleMeshJobs } from "./lib/mesh.js";
import { getDb } from "./db/index.js";

const PORT = Number(process.env.MOTION_API_PORT || 5190);
const HOST = process.env.MOTION_API_HOST || "127.0.0.1";

ensureDataDirs();
ensureMeshDirs();
const db = getDb();
recoverStaleProcessing(db);
recoverStaleMeshJobs(db);

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 * 512 });

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 512
  }
});

registerVideoRoutes(app);
registerSegmentRoutes(app);
registerFileRoutes(app);
registerDetectionRoutes(app);
registerAnimalRoutes(app);
registerMeshRoutes(app);

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`Motion API listening on http://${HOST}:${PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
