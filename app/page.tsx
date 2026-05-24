"use client";

import { useCallback, useState } from "react";

import { DIALECT_CUE_CHIPS, DIALECT_OPTIONS, DIALECT_SAMPLES } from "@/lib/dialect-samples";

type FactRow = { fact_key: string; label: string; value: string; source: string };
type ExtractJson = {
  file_name?: string;
  intake_kind?: string;
  text_preview?: string;
  full_text_normalized?: string;
  candidate_facts?: FactRow[];
  extractable?: boolean;
  warnings?: string[];
  ocr_provenance?: Record<string, unknown>;
};
type DialectEvidence = {
  status?: string;
  dialect_label?: string | null;
  speaker_region?: string | null;
  match_score?: number | null;
  candidate_label?: string | null;
  source?: string;
};

/** Primary surface: dialect lab UX with document OCR feeding the transcript (`factory-VERIDYN` styling cues). */
export default function DialectLabHomePage() {
  const [text, setText] = useState<string>(DIALECT_CUE_CHIPS[0].phrase);
  const [dialect, setDialect] = useState<string>("sylhet");
  const [region, setRegion] = useState<string>("Sylhet");

  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("ben+eng");
  const [extractBusy, setExtractBusy] = useState(false);
  const [dialectBusy, setDialectBusy] = useState(false);
  const [extract, setExtract] = useState<ExtractJson | null>(null);
  const [dialectEvidence, setDialectEvidence] = useState<DialectEvidence | null>(null);
  const [errExtract, setErrExtract] = useState<string | null>(null);
  const [errDialect, setErrDialect] = useState<string | null>(null);

  const analyze = useCallback(async (inputText: string) => {
    setDialectBusy(true);
    setErrDialect(null);
    try {
      const res = await fetch("/api/dialect/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });
      const data = (await res.json().catch(() => ({}))) as { evidence?: DialectEvidence; detail?: string };
      if (!res.ok) {
        setErrDialect(typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`);
        return;
      }
      if (data.evidence) {
        setDialectEvidence(data.evidence);
        if (data.evidence.dialect_label) setDialect(data.evidence.dialect_label);
        if (data.evidence.speaker_region) setRegion(data.evidence.speaker_region);
      }
    } catch (e) {
      setErrDialect(e instanceof Error ? e.message : String(e));
    } finally {
      setDialectBusy(false);
    }
  }, []);

  function applyChip(chip: (typeof DIALECT_CUE_CHIPS)[0]) {
    setText(chip.phrase);
    setDialect(chip.dialect);
    setRegion(chip.region);
    void analyze(chip.phrase);
  }

  function applySample(sample: (typeof DIALECT_SAMPLES)[0]) {
    setText(sample.phrase);
    setDialect(sample.dialect);
    setRegion(sample.region);
    void analyze(sample.phrase);
  }

  async function runExtract() {
    if (!file) return;
    setExtractBusy(true);
    setErrExtract(null);
    setExtract(null);
    setDialectEvidence(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("language", language);
      const res = await fetch("/api/documents/extract", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as ExtractJson & { detail?: string };
      if (!res.ok) {
        setErrExtract(typeof data.detail === "string" ? data.detail : `Extract HTTP ${res.status}`);
        return;
      }
      setExtract(data);
      const transcript =
        typeof data.full_text_normalized === "string" && data.full_text_normalized.trim()
          ? data.full_text_normalized
          : typeof data.text_preview === "string"
            ? data.text_preview
            : "";
      setText(transcript.trim() ? transcript : text);
      if (transcript.trim()) await analyze(transcript.trim());
    } catch (e) {
      setErrExtract(e instanceof Error ? e.message : String(e));
    } finally {
      setExtractBusy(false);
    }
  }

  const facts = Array.isArray(extract?.candidate_facts) ? extract.candidate_facts : [];
  const warnings = Array.isArray(extract?.warnings) ? extract.warnings : [];
  const dialectScorePct =
    dialectEvidence?.match_score != null ? Math.round(Number(dialectEvidence.match_score) * 100) : null;

  return (
    <>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark">V</span>
          <span>Veridyn · Bengali Dialect Lab</span>
        </div>
        <nav className="site-nav">
          <span className="nav-active nav-pill-static">Dialect + OCR</span>
        </nav>
      </header>

      <main className="lab-main">
        <section className="hero-banner">
          <div className="hero-banner-main">
            <p className="kicker">VERIDYN · English + Bengali OCR backbone</p>
            <h1>Dialect phrase lab</h1>
            <p className="lead hero-lead">
              Upload scans or PDFs → real OCR fills the Bengali transcript below → cue chips / RegSpeech samples for
              play → optional cue-based dialect analysis. Protein-chain and every other product integrates the same pipeline
              via <code>POST /api/documents/extract</code>.
            </p>
          </div>
          <aside className="truth-card">
            <strong>Architecture</strong>
            <p>
              OCR is <strong>never</strong> mocked on this deployment — WASM Tesseract for EN/BN intake. The engaging UI is
              dialect discovery; integrations only need the multipart extract route.
            </p>
          </aside>
        </section>

        <section className="panel panel-primary lab-section" id="document-ocr">
          <div className="panel-head">
            <h2>① From document scan (OCR → transcript)</h2>
            <span className="panel-badge ok">Production path</span>
          </div>
          <div className="field-row">
            <div className="field">
              <label htmlFor="language">OCR language hint</label>
              <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={extractBusy}>
                <option value="ben+eng">ben+eng — Bengali + English (default)</option>
                <option value="ben">ben — Bengali primary</option>
                <option value="eng">eng — English Latin</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="ocr-file">File</label>
              <input
                id="ocr-file"
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.pdf,.txt,.md,.csv,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={extractBusy}
              />
              <span className="hint">PNG, JPG, PDF (with text layer or render), DOCX · max 10 MB</span>
            </div>
          </div>

          <button type="button" className="btn-primary" disabled={extractBusy || !file} onClick={() => void runExtract()}>
            {extractBusy ? "Running OCR…" : "Extract text → fill transcript"}
          </button>

          {errExtract ? (
            <div className="panel panel-error ocr-inline-error">
              <strong>OCR failed</strong>
              <pre>{errExtract}</pre>
            </div>
          ) : null}

          {extract ? (
            <div className="ocr-mini-results">
              {extract.extractable ? (
                <p className="meta-line meta-ok">
                  Text extracted{facts.length ? ` · ${facts.length} autofill clues` : ""}.
                </p>
              ) : (
                <p className="meta-line">No text layer found — try a clearer scan or PNG export.</p>
              )}
              {warnings.length ? (
                <ul className="warning-list">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <details className="facts-disclosure">
                <summary>OCR snippet &amp; extracted facts</summary>
                <div className="text-preview bangla ocr-snippet">{text || "(empty)"}</div>
                {facts.length ? (
                  <div className="facts-table-wrap">
                    <table className="facts-table">
                      <thead>
                        <tr>
                          <th>Field</th>
                          <th>Value</th>
                        </tr>
                      </thead>
                      <tbody>
                        {facts.map((f) => (
                          <tr key={`${f.fact_key}:${f.label}`}>
                            <td>{f.label}</td>
                            <td>
                              <code>{f.value}</code>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </details>
            </div>
          ) : null}
        </section>

        <div className="lab-grid" id="dialect-analysis">
          <section className="panel">
            <div className="panel-head lab-panel-head-inline">
              <h2 className="section-title" style={{ margin: 0 }}>
                Transcript · cue chips · samples
              </h2>
              <button type="button" className="btn-secondary btn-sm" onClick={() => void analyze(text.trim())}>
                Re-run dialect
              </button>
            </div>

            <div className="field">
              <label htmlFor="transcript">Observed transcript</label>
              <textarea
                id="transcript"
                className="bangla textarea-lg"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={6}
              />
              <span className="hint">Typed, pasted, or hydrated from OCR in step ①.</span>
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
                <label htmlFor="dialect">Dialect label</label>
                <select id="dialect" value={dialect} onChange={(e) => setDialect(e.target.value)}>
                  {DIALECT_OPTIONS.map((o) => (
                    <option key={o.value || "unknown"} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label htmlFor="region">Speaker region</label>
                <input id="region" value={region} onChange={(e) => setRegion(e.target.value)} />
              </div>
            </div>

            <button
              type="button"
              className="btn-primary"
              disabled={dialectBusy || !text.trim()}
              onClick={() => void analyze(text.trim())}
            >
              {dialectBusy ? "Analyzing cues…" : "Analyze dialect (POST /api/dialect/analyze)"}
            </button>

            {errDialect ? <pre className="error-pre">{errDialect}</pre> : null}

            <div className="sample-section">
              <h3 className="section-title">Regional samples</h3>
              <p className="meta-line">RegSpeech12-style reference phrases · click loads text + cue analysis.</p>
              <div className="sample-grid">
                {DIALECT_SAMPLES.filter((s) => s.source === "RegSpeech12" || s.id.endsWith("-long")).map((sample) => (
                  <article key={sample.id} className="sample-card">
                    <strong>{sample.region}</strong>
                    <span className="sample-meta">{sample.source}</span>
                    <p className="bangla sample-phrase">{sample.phrase.slice(0, 120)}…</p>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => applySample(sample)}>
                      Use sample
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="panel verdict-panel lab-verdict-stick">
            <h2 className="section-title">Dialect verdict</h2>
            <div className="score-dial" style={{ "--score": dialectScorePct ?? 0 } as React.CSSProperties}>
              <div>
                <span className="score">{dialectScorePct != null ? `${dialectScorePct}%` : "—"}</span>
                <span className={`pill pill-${dialectEvidence?.status ?? "unknown"}`}>
                  {dialectEvidence?.status ?? "awaiting transcript"}
                </span>
              </div>
            </div>

            <div className="dialect-kv-stack">
              <div className="dialect-kv">
                <span>Suggested dialect</span>
                <strong>{dialectEvidence?.dialect_label ?? "—"}</strong>
              </div>
              <div className="dialect-kv">
                <span>Region</span>
                <strong>{dialectEvidence?.speaker_region ?? region}</strong>
              </div>
              <div className="dialect-kv">
                <span>Matched cue</span>
                <strong>{dialectEvidence?.candidate_label ?? "—"}</strong>
              </div>
              <div className="dialect-kv">
                <span>Evidence source</span>
                <strong>{dialectEvidence?.source ?? "—"}</strong>
              </div>
            </div>

            {!dialectEvidence ? (
              <p className="meta-line">Run OCR or pick a cue chip — analysis calls the cue engine on transcript text.</p>
            ) : (
              <details>
                <summary>Evidence JSON</summary>
                <pre>{JSON.stringify(dialectEvidence, null, 2)}</pre>
              </details>
            )}
          </section>
        </div>

        <footer>
          Integration endpoints: <code>GET /api/health</code> · <code>POST /api/documents/extract</code> ·{" "}
          <code>POST /api/dialect/analyze</code> · Operators: repo <code>docs/OCR_DIALECT_SERVICE.md</code>.
        </footer>
      </main>
    </>
  );
}
