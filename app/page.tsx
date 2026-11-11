"use client";

import { useState } from "react";

import { DIALECT_CUE_CHIPS, DIALECT_OPTIONS, DIALECT_SAMPLES } from "@/lib/dialect-samples";

/**
 * Public reference surface (W5 honesty pass, based on PR #30).
 *
 * The mutation APIs are bearer-protected and this unauthenticated page must
 * never receive, relay, or call them with the service API key. This page makes
 * no network calls at all: cue chips and regional samples are bundled static
 * reference data, and the panels below document the server-side contract
 * (endpoints, limits, curl examples) for authenticated consumers.
 * Authenticated consumers call the APIs from their own server-side code —
 * see docs/CONSUMERS.md in the repository.
 */
export default function DialectLabHomePage() {
  const [text, setText] = useState<string>(DIALECT_CUE_CHIPS[0].phrase);
  const [dialect, setDialect] = useState<string>("sylhet");
  const [region, setRegion] = useState<string>("Sylhet");

  function applyChip(chip: (typeof DIALECT_CUE_CHIPS)[0]) {
    setText(chip.phrase);
    setDialect(chip.dialect);
    setRegion(chip.region);
  }

  function applySample(sample: (typeof DIALECT_SAMPLES)[0]) {
    setText(sample.phrase);
    setDialect(sample.dialect);
    setRegion(sample.region);
  }

  const dialectLabel = DIALECT_OPTIONS.find((option) => option.value === dialect)?.label ?? dialect;

  return (
    <>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark">V</span>
          <span>Veridyn · Bengali Dialect Reference</span>
        </div>
        <nav className="site-nav">
          <span className="nav-active nav-pill-static">Dialect + OCR</span>
        </nav>
      </header>

      <main className="lab-main">
        <section className="hero-banner">
          <div className="hero-banner-main">
            <p className="kicker">VERIDYN · authenticated OCR service</p>
            <h1>Dialect and OCR integration reference</h1>
            <p className="lead hero-lead">
              This public page previews bundled Bengali cue phrases and documents the protected service contract. It does
              not call the OCR or dialect APIs because those routes require a server-held bearer key, and no API key is sent to this browser.
            </p>
          </div>
          <aside className="truth-card">
            <strong>Vercel runtime</strong>
            <p>
              Image and scanned-PDF OCR uses a configured vision provider on Vercel (Vertex, then Gemini, then
              OpenRouter). The <code>tesseract.js</code> fallback (ben+eng) is available only outside Vercel.
            </p>
          </aside>
        </section>

        <section className="panel panel-primary lab-section" id="document-ocr">
          <div className="panel-head">
            <h2>① Document OCR API</h2>
            <span className="panel-badge">Server auth required</span>
          </div>
          <p className="meta-line">
            <code>POST /api/documents/extract</code> accepts authenticated multipart uploads. The public page does not
            upload files or proxy this route. Call it from a trusted server with{" "}
            <code>Authorization: Bearer &lt;server-side API key&gt;</code>. Output is candidate evidence only —
            review it before treating any value as verified.
          </p>
          <div className="field-row">
            <div className="field">
              <strong>Accepted input</strong>
              <span className="hint">
                PNG, JPG, WEBP, BMP, TIF, PDF, DOCX, TXT, MD, CSV · max 10 MB · PDFs: text layer up to 50 pages, scanned-page OCR up to 10 pages within a 50s budget (truncation is warned, never silent; per-page records in <code>pages</code>)
              </span>
            </div>
            <div className="field">
              <strong>Vercel scan engine</strong>
              <span className="hint">Configured Vertex, Gemini, or OpenRouter vision provider</span>
            </div>
          </div>
          <details>
            <summary>Server-side curl examples (run where the key lives — never in a browser)</summary>
            <pre>{`# Health probe (public, no key):
curl https://veridyn-ocr-dialect-service.vercel.app/api/health

# Extract (bearer key held server-side only):
curl -X POST https://veridyn-ocr-dialect-service.vercel.app/api/documents/extract \\
  -H "Authorization: Bearer <server-side API key>" \\
  -F file=@scan.png -F language=ben+eng

# Dialect cue analysis (heuristic suggestion, not a verified label):
curl -X POST https://veridyn-ocr-dialect-service.vercel.app/api/dialect/analyze \\
  -H "Authorization: Bearer <server-side API key>" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"..."}'`}</pre>
          </details>
        </section>

        <section className="panel lab-section" id="capability-matrix">
          <div className="panel-head">
            <h2>Capability matrix</h2>
            <span className="panel-badge">Static reference</span>
          </div>
          <p className="meta-line">
            What each route accepts and returns today. Heuristic and provider output is labelled as candidate
            evidence in responses (<code>warnings</code>, <code>candidate_facts</code>, evidence{" "}
            <code>status</code>); nothing on this service marks a value as human-verified.
          </p>
          <div className="facts-table-wrap">
            <table className="facts-table">
              <thead>
                <tr>
                  <th>Endpoint</th>
                  <th>Auth</th>
                  <th>Input · limit</th>
                  <th>Returns</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>
                    <code>GET /api/health</code>
                  </td>
                  <td>Public probe</td>
                  <td>
                    Optional <code>?warm=ocr</code>
                  </td>
                  <td>
                    <code>ok</code>, <code>runtime_sha</code>, <code>contract_version</code>; with warm,{" "}
                    <code>ocr_warm</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>POST /api/documents/extract</code>
                  </td>
                  <td>Bearer (server-held)</td>
                  <td>Multipart file · max 10 MB · PDF text ≤50 pages / scan OCR ≤10 pages (50s budget)</td>
                  <td>
                    <code>file_name</code>, <code>text_preview</code>, <code>full_text_normalized</code>,{" "}
                    <code>pages</code> (PDF), <code>candidate_facts</code>,{" "}
                    <code>structured_fields</code> (<code>bd_extract.v1</code>: NID / trade licence / passport MRZ / invoice candidates, review-required), <code>extractable</code>, <code>warnings</code>,{" "}
                    <code>ocr_provenance</code>
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>POST /api/dialect/analyze</code>
                  </td>
                  <td>Bearer (server-held)</td>
                  <td>
                    JSON <code>{`{ text, use_classifier? }`}</code> · scoring caps input at 2,000 chars (<code>input_truncated</code>)
                  </td>
                  <td>
                    <code>dialect_cue.v1</code> evidence: <code>suggested</code> / <code>unresolved</code> /{" "}
                    <code>missing_transcript</code> + additive <code>script_mix</code> — a cue-match suggestion (11 labels, 19 cue phrases; Rajshahi/Khulna/Mymensingh/Cumilla cues are curated candidate evidence needing a stronger match), not a verified label. <code>use_classifier: true</code> opts into the Vertex classifier resolver.
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>POST /api/phrase-eval</code>
                  </td>
                  <td>Bearer (server-held)</td>
                  <td>JSON phrases · max 50 per request</td>
                  <td>
                    <code>phrase_eval.v1</code> per-phrase cue evidence
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>POST /api/facts/extract</code>
                  </td>
                  <td>Bearer (server-held)</td>
                  <td>
                    JSON <code>{`{ text }`}</code> · max 500 KB
                  </td>
                  <td>
                    <code>facts_extract.v1</code> <code>candidate_facts</code> — deterministic regex hints, not
                    verified facts and not document-type schemas
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>POST /api/image-intent</code>
                  </td>
                  <td>Bearer (server-held)</td>
                  <td>Multipart image (JPEG/PNG/WEBP) · max 4 MB</td>
                  <td>
                    <code>image_intent.v1</code>, or <code>{`{ fallback: true }`}</code> when no vision provider is
                    configured
                  </td>
                </tr>
                <tr>
                  <td>
                    <code>POST /api/voice/transcribe</code>
                  </td>
                  <td>Bearer (server-held)</td>
                  <td>Audio (webm/ogg/m4a/mp4/mpeg/wav) · max 8 MB</td>
                  <td>
                    Transcript + dialect evidence, or <code>{`{ fallback: true }`}</code> when no speech provider is
                    configured
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="meta-line">
            Known limits, stated plainly: synchronous requests (60 s route budget), no layout or bounding-box output,
            confidence values are provider/heuristic estimates, and the dialect cue catalog covers a small set of
            labels — many real dialect inputs correctly return <code>unresolved</code>.
          </p>
        </section>

        <section className="panel lab-section" id="consumer-onboarding">
          <div className="panel-head">
            <h2>Consumer onboarding</h2>
            <span className="panel-badge">Server-side only</span>
          </div>
          <ol className="warning-list">
            <li>Ask the service operator for access. The operator can issue a per-consumer named key (individually revocable, usage-attributed in server logs); deployments without named keys fall back to the shared service key with its staged-rotation successor. Quotas and rate limits are not yet available, so do not assume tenant isolation beyond key separation.</li>
            <li>Store the key only in your server-side secret store. Never ship it to a browser, mobile client, or public repository, and never proxy it through a public page.</li>
            <li>Point your server at the service base URL, confirm <code>GET /api/health</code>, then make one authenticated extract call with a synthetic document before using real uploads.</li>
            <li>Handle <code>401</code> (bad/missing key), <code>403</code> (service key not configured — do not retry-storm), <code>400</code>/<code>413</code>/<code>415</code> (input problems), and <code>{`{ fallback: true }`}</code> (provider not configured) explicitly.</li>
            <li>Treat all extracted text, facts, and dialect labels as candidate evidence requiring review. Full steps: <code>docs/CONSUMERS.md</code> in the repository.</li>
          </ol>
          <p className="meta-line">
            Sole verified production consumer: <strong>ProteinChain</strong>. No other product is recorded as a
            verified production consumer of this deployment; a product being named in an example or roadmap is not
            evidence that it calls this service.
          </p>
        </section>

        <div className="lab-grid">
          <section className="panel">
            <div className="panel-head lab-panel-head-inline">
              <h2 className="section-title" style={{ margin: 0 }}>
                ② Bundled phrase reference
              </h2>
              <span className="panel-badge">No API call</span>
            </div>

            <div className="field">
              <label htmlFor="transcript">Reference text (static)</label>
              <textarea
                id="transcript"
                className="bangla textarea-lg"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={6}
              />
              <span className="hint">
                Typed, pasted, or loaded from a bundled cue below. This editor does not produce a live dialect verdict
                and nothing typed here leaves the browser.
              </span>
            </div>

            <div className="chip-row">
              <span className="chip-label">Cue chips (static)</span>
              {DIALECT_CUE_CHIPS.map((chip) => (
                <button key={chip.id} type="button" className="chip" onClick={() => applyChip(chip)}>
                  {chip.label}
                </button>
              ))}
            </div>

            <div className="field-row">
              <div className="field">
                <label htmlFor="dialect">Reference dialect label</label>
                <select id="dialect" value={dialect} onChange={(event) => setDialect(event.target.value)}>
                  {DIALECT_OPTIONS.map((option) => (
                    <option key={option.value || "unknown"} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="region">Reference region</label>
                <input id="region" value={region} onChange={(event) => setRegion(event.target.value)} />
              </div>
            </div>

            <div className="sample-section">
              <h3 className="section-title">Regional samples (static)</h3>
              <p className="meta-line">Bundled RegSpeech12-style reference phrases · click to load local metadata only.</p>
              <div className="sample-grid">
                {DIALECT_SAMPLES.filter((sample) => sample.source === "RegSpeech12" || sample.id.endsWith("-long")).map(
                  (sample) => (
                    <article key={sample.id} className="sample-card">
                      <strong>{sample.region}</strong>
                      <span className="sample-meta">{sample.source}</span>
                      <p className="bangla sample-phrase">
                        {sample.phrase.slice(0, 120)}
                        {sample.phrase.length > 120 ? "…" : ""}
                      </p>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => applySample(sample)}>
                        Load reference
                      </button>
                    </article>
                  ),
                )}
              </div>
            </div>
          </section>

          <section className="panel verdict-panel lab-verdict-stick">
            <h2 className="section-title">Reference metadata</h2>
            <p className="meta-line">
              These values come from the selected bundled phrase, not from <code>/api/dialect/analyze</code>. A live
              analysis requires an authenticated server-side call and returns a heuristic suggestion (
              <code>suggested</code> or <code>unresolved</code>), never a verified dialect label.
            </p>
            <div className="dialect-kv-stack">
              <div className="dialect-kv">
                <span>Reference dialect</span>
                <strong>{dialectLabel || "—"}</strong>
              </div>
              <div className="dialect-kv">
                <span>Reference region</span>
                <strong>{region || "—"}</strong>
              </div>
              <div className="dialect-kv">
                <span>Evidence source</span>
                <strong>Bundled reference data (static)</strong>
              </div>
            </div>
          </section>
        </div>

        <section className="panel panel-primary lab-section" id="phrase-eval-batch">
          <div className="panel-head">
            <h2>③ Batch phrase-eval API</h2>
            <span className="panel-badge">Server auth required</span>
          </div>
          <p className="meta-line">
            <code>POST /api/phrase-eval</code> accepts up to 50 phrases from authenticated server-side consumers and
            returns per-phrase cue evidence. Batch evaluation is intentionally unavailable on this unauthenticated
            page. See <code>docs/CONSUMERS.md</code> for the request/response contract and error handling.
          </p>
        </section>

        <footer>
          Public probe: <code>GET /api/health</code> · Protected integrations:{" "}
          <code>POST /api/documents/extract</code> · <code>POST /api/dialect/analyze</code> ·{" "}
          <code>POST /api/phrase-eval</code> · <code>POST /api/facts/extract</code> ·{" "}
          <code>POST /api/image-intent</code> · <code>POST /api/voice/transcribe</code> · Operators: repo{" "}
          <code>docs/OCR_DIALECT_SERVICE.md</code> · Consumers: repo <code>docs/CONSUMERS.md</code>.
        </footer>
      </main>
    </>
  );
}
