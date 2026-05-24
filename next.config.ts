import path from "node:path";
import { fileURLToPath } from "node:url";

import type { NextConfig } from "next";

const nextConfigDir = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  outputFileTracingRoot: nextConfigDir,
  serverExternalPackages: ["@napi-rs/canvas", "tesseract.js"],
  outputFileTracingIncludes: {
    "/api/documents/extract": [
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
      "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      "./node_modules/tesseract.js/dist/worker.min.js",
      "./node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js",
      "./tessdata/**",
    ],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "11mb",
    },
  },
};

export default nextConfig;
