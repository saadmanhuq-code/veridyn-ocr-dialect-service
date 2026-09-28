import { test } from "node:test";
import assert from "node:assert/strict";

import { getOcrWorker } from "./ocr-engine.js";

test("requesting Bengali after English uses a separate OCR worker while English reuses its own", async () => {
  const workers: Array<{ terminate: () => Promise<unknown> }> = [];
  try {
    const english = await getOcrWorker("eng");
    workers.push(english);
    const bengali = await getOcrWorker("ben");
    workers.push(bengali);
    const englishAgain = await getOcrWorker("eng");
    assert.notStrictEqual(bengali, english, "a Bengali request must not inherit an English-only worker");
    assert.strictEqual(englishAgain, english, "same-language requests should reuse their worker");
  } finally {
    await Promise.allSettled([...new Set(workers)].map((worker) => worker.terminate()));
  }
});

test("unpackaged OCR language cannot reuse a prior worker", async () => {
  await assert.rejects(getOcrWorker("hin"), /Unsupported OCR language/);
});
