"use client";

import { useState } from "react";

type ExtractJson = Record<string, unknown>;
type DialectEvidence = Record<string, unknown>;

export default function HomePage() {
  const [file, setFile] = useState<File | null>(null);
  const [language, setLanguage] = useState("ben+eng");
  const [busy, setBusy] = useState(false);
  const [extract, setExtract] = useState<ExtractJson | null>(null);
  const [dialect, setDialect] = useState<DialectEvidence | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function analyze() {
    if (!file) return;
    setBusy(true);
    setErr(null);
    setDialect(null);
    setExtract(null);
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("language", language);

      const ex = await fetch("/api/documents/extract", {
        method: "POST",
        body: form,
      });
      const ej = await ex.json().catch(() => ({}));
      if (!ex.ok) {
        setErr(typeof ej.detail === "string" ? ej.detail : `Extract HTTP ${ex.status}`);
        return;
      }
      setExtract(ej as ExtractJson);

      const txt =
        typeof ej.full_text_normalized === "string"
          ? (ej.full_text_normalized as string)
          : typeof ej.text_preview === "string"
            ? (ej.text_preview as string)
            : "";

      if (txt.trim()) {
        const dr = await fetch("/api/dialect/analyze", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: txt }),
        });
        const dj = await dr.json().catch(() => ({}));
        if (dr.ok && dj.evidence && typeof dj.evidence === "object") {
          setDialect(dj.evidence as DialectEvidence);
        }
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const previewBn = typeof extract?.full_text_normalized === "string" ? extract.full_text_normalized : "";

  return (
    <main>
      <h1>Veridyn OCR · Dialect catcher</h1>
      <p className="lead">
        Upload a document or image → OCR (<span className="bangla">বাংলা</span> + English) → cue-based dialect inference from
        the VERIDYN Bengali dialect lab. Endpoints integrate with sibling products via{" "}
        <code style={{ wordBreak: "break-all" }}>VERIDYN_OCR_URL</code>.
      </p>

      <section className="panel">
        <label htmlFor="language">Language hint (passed to OCR)</label>
        <select id="language" value={language} onChange={(e) => setLanguage(e.target.value)} disabled={busy}>
          <option value="ben+eng">ben+eng — mixed / default</option>
          <option value="ben">ben — Bengali primary</option>
          <option value="eng">eng — English Latin</option>
        </select>

        <label htmlFor="f" style={{ marginTop: "1rem" }}>
          File (.png/.jpg/.pdf/.docx/.txt …)
        </label>
        <input
          id="f"
          type="file"
          accept=".png,.jpg,.jpeg,.webp,.bmp,.tif,.tiff,.pdf,.txt,.md,.csv,.docx"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          disabled={busy}
        />

        <button type="button" disabled={busy || !file} onClick={analyze}>
          Extract + dialect
        </button>
      </section>

      {err ? (
        <section className="panel">
          <strong>Error</strong>
          <pre>{err}</pre>
        </section>
      ) : null}

      {extract ? (
        <section className="panel">
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>OCR preview</h2>
          <p className="bangla" style={{ marginTop: 0 }}>
            {previewBn.slice(0, 2000)}
            {typeof previewBn === "string" && previewBn.length > 2000 ? "…" : ""}
          </p>
          <details>
            <summary>Raw JSON</summary>
            <pre>{JSON.stringify(extract, null, 2)}</pre>
          </details>
        </section>
      ) : null}

      {dialect ? (
        <section className="panel">
          <h2 style={{ marginTop: 0, fontSize: "1rem" }}>Dialect cue evidence</h2>
          <pre>{JSON.stringify(dialect, null, 2)}</pre>
        </section>
      ) : null}

      <footer>
        <code>GET /api/health</code> · <code>POST /api/documents/extract</code> (multipart <code>file</code>, optional{" "}
        <code>language</code>) · <code>POST /api/dialect/analyze</code> (<code>&#123;&quot;text&quot;: &quot;…&quot;&#125;</code>). See{" "}
        <code>docs/OCR_DIALECT_SERVICE.md</code>.
      </footer>
    </main>
  );
}
