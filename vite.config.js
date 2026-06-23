import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const SCAN_SCRIPT = path.join(ROOT, "scripts/scan-body-models.js");

function runBodyModelScan() {
  execSync(`node "${SCAN_SCRIPT}"`, { cwd: ROOT, stdio: "inherit" });
}

function rescanMiddleware(req, res, next) {
  if (req.method !== "POST" || req.url !== "/api/rescan-models") {
    next();
    return;
  }

  try {
    runBodyModelScan();
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: true }));
  } catch (error) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ ok: false, error: String(error?.message || error) }));
  }
}

function modelsScanPlugin() {
  return {
    name: "models-scan",
    buildStart() {
      runBodyModelScan();
    },
    configureServer(server) {
      server.middlewares.use(rescanMiddleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rescanMiddleware);
    }
  };
}

export default defineConfig({
  base: "/",
  plugins: [modelsScanPlugin()],
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/examples/")) return "three-addons";
          if (id.includes("node_modules/three/")) return "three";
        }
      }
    }
  }
});
