"use client";

import { useState } from "react";

import { DIALECT_CUE_CHIPS, DIALECT_OPTIONS, DIALECT_SAMPLES } from "@/lib/dialect-samples";

/**
 * Public reference surface.
 *
 * The mutation APIs are bearer-protected and this unauthenticated page must
 * never receive or relay the service API key. Authenticated consumers call the
 * APIs from their own server-side integration.
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
              not call the OCR or dialect APIs because those routes require a server-held bearer key.
            </p>
          </div>
          <aside className="truth-card">
            <strong>Vercel runtime</strong>
            <p>
              Image and scanned-PDF OCR uses a configured vision provider on Vercel. The <code>tesseract.js</code>{" "}
              fallback is available only outside Vercel; no API key is sent to this browser.
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
            <code>Authorization: Bearer &lt;server-side API key&gt;</code>.
          </p>
          <div className="field-row">
            <div className="field">
              <strong>Accepted input</strong>
              <span className="hint">PNG, JPG, PDF, DOCX, and text formats · max 10 MB</span>
            </div>
            <div className="field">
              <strong>Vercel scan engine</strong>
              <span className="hint">Configured Vertex, Gemini, or OpenRouter vision provider</span>
            </div>
          </div>
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
              <label htmlFor="transcript">Reference text</label>
              <textarea
                id="transcript"
                className="bangla textarea-lg"
                value={text}
                onChange={(event) => setText(event.target.value)}
                rows={6}
              />
              <span className="hint">
                Typed, pasted, or loaded from a bundled cue below. This editor does not produce a live dialect verdict.
              </span>
            </div>

            <div className="chip-row">
              <span className="chip-label">Cue chips</span>
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
              <h3 className="section-title">Regional samples</h3>
              <p className="meta-line">Bundled RegSpeech12-style reference phrases · click to load local metadata.</p>
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
              These values come from the selected bundled phrase, not from <code>/api/dialect/analyze</code>.
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
                <strong>Bundled reference data</strong>
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
            <code>POST /api/phrase-eval</code> accepts up to 50 phrases from authenticated server-side consumers. Batch
            evaluation is intentionally unavailable on this unauthenticated page.
          </p>
        </section>

        <footer>
          Public probe: <code>GET /api/health</code> · Protected integrations:{" "}
          <code>POST /api/documents/extract</code> · <code>POST /api/dialect/analyze</code> ·{" "}
          <code>POST /api/phrase-eval</code> · <code>POST /api/facts/extract</code>.
        </footer>
      </main>
    </>
  );
}
