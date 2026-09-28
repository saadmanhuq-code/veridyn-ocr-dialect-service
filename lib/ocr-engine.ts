import path from "node:path";
import { createWorker, type Worker } from "tesseract.js";

const SUPPORTED_OCR_LANGUAGES = new Set(["ben", "eng", "ben+eng"]);
const workerPromises = new Map<string, Promise<Worker>>();

export function tessDataPath(): string {
  return path.join(process.cwd(), "tessdata");
}

export async function getOcrWorker(language = "ben+eng"): Promise<Worker> {
  const normalized = language.trim().toLowerCase();
  if (!SUPPORTED_OCR_LANGUAGES.has(normalized)) {
    throw new RangeError(`Unsupported OCR language: ${language}`);
  }

  let workerPromise = workerPromises.get(normalized);
  if (!workerPromise) {
    const created = createWorker(normalized, 1, {
      langPath: tessDataPath(),
      cachePath: path.join("/tmp", "tesseract-cache"),
      gzip: false,
    });
    workerPromises.set(normalized, created);
    created.catch(() => {
      if (workerPromises.get(normalized) === created) workerPromises.delete(normalized);
    });
    workerPromise = created;
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
