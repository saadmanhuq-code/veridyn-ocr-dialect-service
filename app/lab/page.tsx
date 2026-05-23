"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import { DIALECT_CUE_CHIPS, DIALECT_OPTIONS, DIALECT_SAMPLES } from "@/lib/dialect-samples";

type DialectEvidence = {
  status?: string;
  dialect_label?: string | null;
  speaker_region?: string | null;
  match_score?: number | null;
  candidate_label?: string | null;
  source?: string;
};

export default function DialectLabPage() {
  const [text, setText] = useState(DIALECT_CUE_CHIPS[0].phrase);
  const [dialect, setDialect] = useState("sylhet");
  const [region, setRegion] = useState("Sylhet");
  const [busy, setBusy] = useState(false);
  const [evidence, setEvidence] = useState<DialectEvidence | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const analyze = useCallback(async (inputText: string) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch("/api/dialect/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: inputText }),
      });
      const data = (await res.json().catch(() => ({}))) as { evidence?: DialectEvidence; detail?: string };
      if (!res.ok) {
        setErr(typeof data.detail === "string" ? data.detail : `HTTP ${res.status}`);
        return;
      }
      if (data.evidence) {
        setEvidence(data.evidence);
        if (data.evidence.dialect_label) setDialect(data.evidence.dialect_label);
        if (data.evidence.speaker_region) setRegion(data.evidence.speaker_region);
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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

  const scorePct =
    evidence?.match_score != null ? Math.round(Number(evidence.match_score) * 100) : 0;

  return (
    <>
      <header className="site-header">
        <div className="brand">
          <span className="brand-mark">V</span>
          <span>Veridyn OCR</span>
        </div>
        <nav className="site-nav">
          <Link href="/">Document OCR</Link>
          <Link href="/lab" className="nav-active">
            Dialect add-on
          </Link>
        </nav>
      </header>

      <main className="lab-main">
        <div className="addon-banner">
          <strong>Add-on module</strong>
          <p>
            Bengali dialect cue lab — secondary to{" "}
            <Link href="/">Document OCR (English + Bengali)</Link>. API consumers use{" "}
            <code>/api/dialect/analyze</code> only when needed.
          </p>
        </div>

        <section className="hero hero-lab">
          <p className="kicker">VERIDYN Bengali Language · optional</p>
          <h1>Dialect Phrase Lab</h1>
          <p className="lead">
            Paste Bengali transcript text or load regional samples — cue-based dialect inference against Sylhet,
            Barishal, Chattogram, Noakhali, and RegSpeech12 reference phrases.
          </p>
        </section>

        <div className="lab-grid">
          <section className="panel">
            <h2 className="section-title">Transcript input</h2>

            <div className="field">
              <label htmlFor="transcript">Observed transcript</label>
              <textarea
                id="transcript"
                className="bangla textarea-lg"
                value={text}
                onChange={(e) => setText(e.target.value)}
                rows={5}
              />
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

            <button type="button" className="btn-primary" disabled={busy || !text.trim()} onClick={() => analyze(text)}>
              {busy ? "Analyzing…" : "Analyze dialect"}
            </button>

            {err ? <pre className="error-pre">{err}</pre> : null}

            <div className="sample-section">
              <h3 className="section-title">Regional samples</h3>
              <p className="meta-line">RegSpeech12-style reference phrases — click to load and analyze.</p>
              <div className="sample-grid">
                {DIALECT_SAMPLES.filter((s) => s.source === "RegSpeech12" || s.phrase.length > 40).map((sample) => (
                  <article key={sample.id} className="sample-card">
                    <strong>{sample.region}</strong>
                    <span className="sample-meta">{sample.source}</span>
                    <p className="bangla sample-phrase">{sample.phrase.slice(0, 120)}…</p>
                    <button type="button" className="btn-secondary btn-sm" onClick={() => applySample(sample)}>
                      Use {sample.region} sample
                    </button>
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="panel verdict-panel">
            <h2 className="section-title">Verdict</h2>
            <div className="score-dial" style={{ "--score": scorePct } as React.CSSProperties}>
              <div>
                <span className="score">{scorePct}%</span>
                <span className={`pill pill-${evidence?.status ?? "unknown"}`}>
                  {evidence?.status ?? "awaiting input"}
                </span>
              </div>
            </div>

            <div className="dialect-kv-stack">
              <div className="dialect-kv">
                <span>Suggested dialect</span>
                <strong>{evidence?.dialect_label ?? "—"}</strong>
              </div>
              <div className="dialect-kv">
                <span>Region</span>
                <strong>{evidence?.speaker_region ?? region}</strong>
              </div>
              <div className="dialect-kv">
                <span>Matched cue</span>
                <strong>{evidence?.candidate_label ?? "—"}</strong>
              </div>
              <div className="dialect-kv">
                <span>Source</span>
                <strong>{evidence?.source ?? "—"}</strong>
              </div>
            </div>

            {evidence ? (
              <details>
                <summary>Evidence JSON</summary>
                <pre>{JSON.stringify(evidence, null, 2)}</pre>
              </details>
            ) : (
              <p className="meta-line">Load a cue chip or sample, or paste transcript text and analyze.</p>
            )}
          </section>
        </div>
      </main>
    </>
  );
}
