import { defineConfig } from "vite";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { resolve } from "path";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        background: resolve(__dirname, "src/background.js"),
        "offscreen-worker": resolve(__dirname, "src/offscreen-worker.js"),
      },
      output: {
        entryFileNames: "src/[name].js",
        chunkFileNames: "src/chunks/[name]-[hash].js",
        format: "es",
      },
    },
    target: "esnext",
    minify: false, // Keep readable for debugging
  },
  plugins: [
    viteStaticCopy({
      targets: [
        // Manifest and static files (not processed by Vite)
        { src: "manifest.json", dest: "." },
        { src: "src/inject.js", dest: "src" },
        { src: "src/content.js", dest: "src" },
        { src: "src/offscreen.html", dest: "src" },
        { src: "popup/*", dest: "popup" },
        { src: "icons/*", dest: "icons" },
        // ONNX Runtime WASM files (needed for Transformers.js)
        {
          src: "node_modules/onnxruntime-web/dist/*.wasm",
          dest: "wasm",
        },
      ],
    }),
  ],
});
