import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { recoverStaleProcessing } from "./lib/processor.js";
import { registerSegmentRoutes, registerVideoRoutes } from "./routes/index.js";
import { registerDetectionRoutes } from "./routes/detection.js";
import { ensureDataDirs } from "./lib/paths.js";
import { getDb } from "./db/index.js";

const PORT = Number(process.env.MOTION_API_PORT || 5190);
const HOST = process.env.MOTION_API_HOST || "127.0.0.1";

ensureDataDirs();
const db = getDb();
recoverStaleProcessing(db);

const app = Fastify({ logger: true, bodyLimit: 1024 * 1024 * 512 });

await app.register(cors, { origin: true });
await app.register(multipart, {
  limits: {
    fileSize: 1024 * 1024 * 512
  }
});

registerVideoRoutes(app);
registerSegmentRoutes(app);
registerDetectionRoutes(app);

try {
  await app.listen({ port: PORT, host: HOST });
  console.log(`Motion API listening on http://${HOST}:${PORT}`);
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
