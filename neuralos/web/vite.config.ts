import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const webRoot = fileURLToPath(new URL(".", import.meta.url));
const kernelTarget = process.env.NEURALOS_API ?? "http://127.0.0.1:7437";

export default defineConfig({
  root: webRoot,
  base: "/",
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    host: "127.0.0.1",
    proxy: {
      "/api": {
        target: kernelTarget,
        changeOrigin: true,
        // The kernel rejects requests whose Origin is not its own. The dev server is a different origin,
        // so drop the header when proxying (the X-NeuralOS-Client header still guards mutations).
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.removeHeader("origin");
          });
          // Keep SSE unbuffered.
          proxy.on("proxyRes", (proxyRes) => {
            if (String(proxyRes.headers["content-type"] ?? "").includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache";
              proxyRes.headers["x-accel-buffering"] = "no";
            }
          });
        },
      },
    },
  },
});
