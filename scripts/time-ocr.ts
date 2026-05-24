import fs from "node:fs";
import { performance } from "node:perf_hooks";
import { recognizeBufferTesseract } from "../lib/ocr-engine";

async function main() {
  const png = fs.readFileSync("../protein-chain-bd/scripts/fixtures/trade-license-smoke.png");
  const t0 = performance.now();
  const r = await recognizeBufferTesseract(png);
  console.log("ms", Math.round(performance.now() - t0), "text", r.text.slice(0, 80));
}

main();
