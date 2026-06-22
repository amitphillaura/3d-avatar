import { defineConfig } from "vite";

// GitHub Pages serves project sites from /repo-name/; local dev and preview use /.
const base = process.env.BASE_PATH || "/";

export default defineConfig({
  base
});
