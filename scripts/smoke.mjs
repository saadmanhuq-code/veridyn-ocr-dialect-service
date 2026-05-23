/**
 * Hits local dev server URLs. Start `npm run dev` first.
 */
const BASE = process.env.SMOKE_BASE || "http://127.0.0.1:3333";
const TOKEN = process.env.VERIDYN_OCR_API_KEY || "";

async function main() {
  const health = await fetch(`${BASE}/api/health`);
  console.log("/api/health", health.status, await health.text());

  const headers = TOKEN ? { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" };
  const d = await fetch(`${BASE}/api/dialect/analyze`, {
    method: "POST",
    headers,
    body: JSON.stringify({ text: "আমি সিলেটি ভাষায় কথা কই" }),
  });
  console.log("/api/dialect/analyze", d.status, await d.text());
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
