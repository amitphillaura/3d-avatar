import { defineConfig } from "vite";
import { resolve } from "node:path";

export default defineConfig({
  base: "/",
  preview: {
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5190",
        changeOrigin: true
      }
    }
  },
  server: {
    allowedHosts: [".ts.net"],
    proxy: {
      "/api": {
        target: "http://127.0.0.1:5190",
        changeOrigin: true
      }
    }
  },
  build: {
    chunkSizeWarningLimit: 650,
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), "index.html"),
        motion: resolve(process.cwd(), "motion.html")
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/three/examples/")) return "three-addons";
          if (id.includes("node_modules/three/")) return "three";
        }
      }
    }
  }
});
