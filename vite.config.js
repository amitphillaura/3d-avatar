import { defineConfig } from "vite";

export default defineConfig({
  base: "/",
  // Allow access over Tailscale (numeric IPs are allowed by default; this adds MagicDNS
  // *.ts.net hostnames). Bound to the interface via the --host flag in the npm scripts.
  preview: { allowedHosts: [".ts.net"] },
  server: { allowedHosts: [".ts.net"] },
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
