import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";

let workerPromise: Promise<Worker> | null = null;

/** Bundled tessdata/ (eng + ben) for local dev fallback. */
export function tessDataPath(): string {
  return path.join(process.cwd(), "tessdata");
}

export async function getOcrWorker(language = "ben+eng"): Promise<Worker> {
  if (!workerPromise) {
    const root = process.cwd();
    workerPromise = createWorker(language, 1, {
      langPath: path.join(root, "tessdata"),
      workerPath: path.join(root, "node_modules/tesseract.js/dist/worker.min.js"),
      corePath: path.join(root, "node_modules/tesseract.js-core/tesseract-core-lstm.wasm.js"),
      cachePath: path.join("/tmp", "tesseract-cache"),
      gzip: false,
    });
  }
  return workerPromise;
}

export async function recognizeBufferTesseract(
  buf: Buffer,
  language = "ben+eng",
): Promise<{ text: string; confidence: number }> {
  const worker = await getOcrWorker(language);
  const {
    data: { text: rawText, confidence: conf },
  } = await worker.recognize(buf);
  return {
    text: (rawText ?? "").replace(/\s+/g, " ").trim(),
    confidence: typeof conf === "number" ? conf / 100 : 0,
  };
}
