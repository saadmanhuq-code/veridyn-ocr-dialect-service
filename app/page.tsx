"use client";

import Link from "next/link";
import { useState } from "react";

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

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("ben+eng");
  const [busy, setBusy] = useState(false);
  const [dialectBusy, setDialectBusy] = useState(false);
  const [extract, setExtract] = useState<ExtractJson | null>(null);
  const [dialect, setDialect] = useState<DialectEvidence | null>(null);
  const [dialectOpen, setDialectOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function runExtract() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setDialect(null);
    setDialectOpen(false);
    setExtract(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("language", language);

      const res = await fetch("/api/documents/extract", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as ExtractJson & { detail?: string };
      if (!res.ok) {
        setErr(typeof data.detail === "string" ? data.detail : `Extract HTTP ${res.status}`);
        return;
      }
      setExtract(data);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function runDialectAnalyze() {
    const txt =
      typeof extract?.full_text_normalized === "string"
        ? extract.full_text_normalized
        : typeof extract?.text_preview === "string"
          ? extract.text_preview
          : "";
    if (!txt.trim()) return;

    setDialectBusy(true);
    setDialectOpen(true);
    try {
      const res = await fetch("/api/dialect/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: txt }),
      });
      const data = (await res.json().catch(() => ({}))) as { evidence?: DialectEvidence };
      if (res.ok && data.evidence) setDialect(data.evidence);
    } finally {
      setDialectBusy(false);
    }
  }

  const fullText =
    typeof extract?.full_text_normalized === "string"
      ? extract.full_text_normalized
      : typeof extract?.text_preview === "string"
        ? extract.text_preview
        : "";
  const facts = Array.isArray(extract?.candidate_facts) ? extract.candidate_facts : [];
  const warnings = Array.isArray(extract?.warnings) ? extract.warnings : [];
  const scorePct =
    dialect?.match_score != null ? Math.round(Number(dialect.match_score) * 100) : null;

  return (
    <>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark">V</span>
          <span>Veridyn OCR</span>
        </div>
        <nav className="site-nav">
          <Link href="/" className="nav-active">
            Document OCR
          </Link>
          <Link href="/lab" className="nav-addon">
            Dialect add-on
          </Link>
        </nav>
      </header>

      <main>
        <section className="hero hero-ocr">
          <p className="kicker">Trade licenses · compliance docs · mixed scripts</p>
          <h1>
            Document OCR
            <span className="hero-sub">
              English + <span className="bangla">বাংলা</span>
            </span>
          </h1>
          <p className="lead">
            Upload a trade license, invoice, or scan — extract Bengali and English text, preview autofill candidate
            fields, then optionally run dialect cue analysis. Integrations call{" "}
            <code>POST /api/documents/extract</code>; dialect is opt-in via{" "}
            <code>POST /api/dialect/analyze</code>.
          </p>
        </section>

        <section className="panel panel-primary">
          <div className="panel-head">
            <h2>1 · Upload document</h2>
            <span className="panel-badge">Primary flow</span>
          </div>

          <div className="field-row">
            <div className="field">
              <label htmlFor="language">OCR language hint</label>
              <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
                <option value="ben+eng">ben+eng — mixed Bengali + English (default)</option>
                <option value="ben">ben — Bengali primary</option>
                <option value="eng">eng — English Latin</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="file">File</label>
              <input
                id="file"
                type="file"
                accept=".png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.pdf,.txt,.md,.csv,.docx"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                disabled={busy}
              />
              <span className="hint">PNG, JPG, PDF (text layer), DOCX, TXT — max 10 MB</span>
            </div>
          </div>

          <button type="button" className="btn-primary" disabled={busy || !file} onClick={runExtract}>
            {busy ? "Extracting…" : "Extract text"}
          </button>
        </section>

        {err ? (
          <section className="panel panel-error">
            <strong>Extraction error</strong>
            <pre>{err}</pre>
          </section>
        ) : null}

        {extract ? (
          <>
            <section className="panel panel-results">
              <div className="panel-head">
                <h2>2 · Extracted text</h2>
                {extract.extractable ? (
                  <span className="panel-badge ok">Text found</span>
                ) : (
                  <span className="panel-badge warn">No text</span>
                )}
              </div>

              {extract.file_name ? (
                <p className="meta-line">
                  {extract.file_name}
                  {extract.intake_kind ? ` · ${extract.intake_kind}` : ""}
                </p>
              ) : null}

              <div className="text-preview bangla">{fullText || "(empty)"}</div>

              {warnings.length ? (
                <ul className="warning-list">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
            </section>

            {facts.length ? (
              <section className="panel panel-results">
                <div className="panel-head">
                  <h2>3 · Autofill candidate fields</h2>
                  <span className="panel-badge">Review required</span>
                </div>
                <p className="meta-line">Regex hints from extracted text — candidate evidence only.</p>
                <div className="facts-table-wrap">
                  <table className="facts-table">
                    <thead>
                      <tr>
                        <th>Field</th>
                        <th>Value</th>
                        <th>Key</th>
                      </tr>
                    </thead>
                    <tbody>
                      {facts.map((f) => (
                        <tr key={f.fact_key}>
                          <td>{f.label}</td>
                          <td>
                            <code>{f.value}</code>
                          </td>
                          <td className="muted">{f.fact_key}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}

            <section className="panel panel-addon">
              <button
                type="button"
                className="addon-toggle"
                aria-expanded={dialectOpen}
                onClick={() => setDialectOpen((o) => !o)}
              >
                <span className="addon-label">
                  <span className="addon-tag">Add-on</span>
                  Dialect cue analysis
                </span>
                <span className="addon-chevron">{dialectOpen ? "▾" : "▸"}</span>
              </button>

              {dialectOpen ? (
                <div className="addon-body">
                  <p className="meta-line">
                    Optional Bengali regional cue matching — does not affect OCR. For full phrase lab with samples,{" "}
                    <Link href="/lab">open Dialect Lab</Link>.
                  </p>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={dialectBusy || !fullText.trim()}
                    onClick={runDialectAnalyze}
                  >
                    {dialectBusy ? "Analyzing…" : "Analyze dialect from extracted text"}
                  </button>

                  {dialect ? (
                    <div className="dialect-summary">
                      <div className="dialect-kv">
                        <span>Status</span>
                        <strong className={`pill pill-${dialect.status ?? "unknown"}`}>{dialect.status}</strong>
                      </div>
                      {dialect.dialect_label ? (
                        <div className="dialect-kv">
                          <span>Suggested dialect</span>
                          <strong>
                            {dialect.dialect_label}
                            {dialect.speaker_region ? ` / ${dialect.speaker_region}` : ""}
                            {scorePct != null ? ` (${scorePct}% cue match)` : ""}
                          </strong>
                        </div>
                      ) : null}
                      {dialect.candidate_label ? (
                        <div className="dialect-kv">
                          <span>Matched cue</span>
                          <strong>{dialect.candidate_label}</strong>
                        </div>
                      ) : null}
                      <details>
                        <summary>Evidence JSON</summary>
                        <pre>{JSON.stringify(dialect, null, 2)}</pre>
                      </details>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </section>

            <details className="panel panel-raw">
              <summary>Raw OCR JSON</summary>
              <pre>{JSON.stringify(extract, null, 2)}</pre>
            </details>
          </>
        ) : null}

        <footer>
          <code>GET /api/health</code> · <code>POST /api/documents/extract</code> ·{" "}
          <code>POST /api/dialect/analyze</code> · See <code>docs/OCR_DIALECT_SERVICE.md</code>
        </footer>
      </main>
    </>
  );
}
