"use client";

import { useEffect, useMemo, useState } from "react";
import type { SkillCatalogSummary, SkillRecord, SkillBenchmarkDimensionScore } from "@/lib/types";

const agentLabels: Record<string, string> = {
  pm: "Product Manager",
  "coder-backend": "Backend Engineer",
  "coder-frontend": "Frontend Engineer",
  coder: "Fullstack Engineer",
  reviewer: "Code Reviewer",
  tester: "QA Engineer",
  security: "Security Engineer",
  sec: "Security Engineer",
  all: "Wszyscy agenci",
};

const dimensionLabels: Record<string, string> = {
  correctness: "Poprawność (Correctness)",
  discoverability: "Wykrywalność (Discoverability)",
  effectiveness: "Skuteczność (Effectiveness)",
  efficiency: "Wydajność (Efficiency)",
  security: "Bezpieczeństwo (Security)",
};

export default function SkillsPanel() {
  const [data, setData] = useState<SkillCatalogSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedAgent, setSelectedAgent] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSkill, setActiveSkill] = useState<SkillRecord | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/skills", { cache: "no-store" })
      .then((res) => {
        if (!active) return null;
        if (!res.ok) {
          setError("Nie udało się pobrać rejestru skilli.");
          return null;
        }
        return res.json();
      })
      .then((payload: SkillCatalogSummary | null) => {
        if (active && payload) {
          setData(payload);
          setError("");
        }
      })
      .catch(() => {
        if (active) setError("Błąd połączenia z rejestrem skilli.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const filteredSkills = useMemo(() => {
    if (!data) return [];
    return data.skills.filter((skill) => {
      const matchAgent =
        selectedAgent === "all" ||
        skill.assignedAgents.includes(selectedAgent) ||
        skill.assignedAgents.includes("*");

      const matchSearch =
        searchQuery.trim() === "" ||
        skill.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
        skill.triggers.some((t) => t.toLowerCase().includes(searchQuery.toLowerCase()));

      return matchAgent && matchSearch;
    });
  }, [data, selectedAgent, searchQuery]);

  return (
    <div className="skills-panel">
      <header className="topbar">
        <div>
          <p className="eyebrow">CAPABILITY GOVERNANCE</p>
          <h1>Verified Agent Skills & Benchmarks</h1>
        </div>
        <div className="top-actions">
          <span className="methodology-badge" title="Ewaluacja w oparciu o standard NVIDIA SkillEvaluator">
            NVIDIA SkillEvaluator Tier 1-3
          </span>
        </div>
      </header>

      {error && <p className="sec-error">{error}</p>}

      {/* KPI Cards */}
      {data && (
        <div className="kpi-grid">
          <div className="kpi-card">
            <span className="kpi-label">Zarejestrowane Skille</span>
            <strong className="kpi-value">{data.totalSkills}</strong>
            <span className="kpi-sub">W katalogu Hermes</span>
          </div>
          <div className="kpi-card highlight-green">
            <span className="kpi-label">Zweryfikowane (Tier 3)</span>
            <strong className="kpi-value">{data.verifiedSkills}</strong>
            <span className="kpi-sub">100% Quality Gate</span>
          </div>
          <div className="kpi-card highlight-cyan">
            <span className="kpi-label">Średni Skill Lift</span>
            <strong className="kpi-value">+{data.avgSkillLift} pkt</strong>
            <span className="kpi-sub">Poprawa jakości A/B</span>
          </div>
          <div className="kpi-card highlight-amber">
            <span className="kpi-label">Oszczędność Tokenów</span>
            <strong className="kpi-value">~{data.avgTokenSavings}%</strong>
            <span className="kpi-sub">Mniej zbędnych kroków</span>
          </div>
        </div>
      )}

      {/* Filters */}
      <section className="sec-section">
        <div className="sec-filters">
          <label className="sec-filter">
            Agent docelowy
            <select value={selectedAgent} onChange={(e) => setSelectedAgent(e.target.value)}>
              <option value="all">Wszyscy agenci</option>
              <option value="pm">Product Manager (pm)</option>
              <option value="reviewer">Code Reviewer (reviewer)</option>
              <option value="coder">Engineers (coder, backend, frontend)</option>
              <option value="tester">QA Automation (tester)</option>
              <option value="security">Security AppSec (sec)</option>
            </select>
          </label>
          <label className="sec-filter search-filter">
            Szukaj skilla
            <input
              type="text"
              placeholder="Filtruj po nazwie, triggerze lub opisie..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </label>
        </div>

        {/* Skill Grid */}
        <div className="skills-grid">
          {loading && <p className="loading-text">Ładowanie rejestru skilli...</p>}
          {!loading && filteredSkills.length === 0 && (
            <p className="empty-text">Brak skilli spełniających wybrane kryteria.</p>
          )}

          {filteredSkills.map((skill) => (
            <div
              key={skill.slug}
              className={`skill-card ${activeSkill?.slug === skill.slug ? "selected" : ""}`}
              onClick={() => setActiveSkill(skill)}
            >
              <div className="card-header">
                <div className="card-title-wrap">
                  <h3>{skill.name}</h3>
                  <span className="skill-version">v{skill.version}</span>
                </div>
                {skill.isVerified ? (
                  <span className="verified-badge">✓ Verified</span>
                ) : (
                  <span className="unverified-badge">Needs Eval</span>
                )}
              </div>

              <p className="card-desc">{skill.description}</p>

              <div className="card-meta">
                <div className="agents-chips">
                  {skill.assignedAgents.map((ag) => (
                    <span key={ag} className="agent-chip">
                      {agentLabels[ag] || ag}
                    </span>
                  ))}
                </div>
                <div className="lift-pill">
                  Lift: <strong>+{skill.overallLift} pkt</strong>
                </div>
              </div>

              <div className="triggers-wrap">
                <span className="triggers-label">Triggery:</span>
                <div className="triggers-list">
                  {skill.triggers.slice(0, 3).map((tr) => (
                    <code key={tr} className="trigger-tag">
                      {tr}
                    </code>
                  ))}
                  {skill.triggers.length > 3 && (
                    <span className="trigger-more">+{skill.triggers.length - 3}</span>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Skill Detail Modal / Drawer */}
      {activeSkill && (
        <div className="modal-backdrop" onClick={() => setActiveSkill(null)}>
          <div className="skill-modal" onClick={(e) => e.stopPropagation()}>
            <header className="modal-header">
              <div>
                <span className="eyebrow">{activeSkill.author}</span>
                <h2>{activeSkill.name} <span className="modal-version">v{activeSkill.version}</span></h2>
              </div>
              <button className="close-btn" onClick={() => setActiveSkill(null)}>✕</button>
            </header>

            <div className="modal-body">
              {/* Benchmarks Section */}
              {activeSkill.benchmarks.length > 0 && (
                <div className="modal-section">
                  <h3>Wyniki Benchmarku (NVIDIA SkillEvaluator A/B Lift)</h3>
                  <div className="metrics-bars">
                    {activeSkill.benchmarks[0]?.scores.map((score: SkillBenchmarkDimensionScore) => (
                      <div key={score.dimension} className="metric-row">
                        <div className="metric-header">
                          <span>{dimensionLabels[score.dimension] || score.dimension}</span>
                          <span className="metric-scores">
                            Baseline: <strong>{score.baselineScore}</strong> ➔ With Skill: <strong>{score.withSkillScore}</strong> (
                            <span className="lift-value">+{score.skillLift} pkt</span>)
                          </span>
                        </div>
                        <div className="progress-track">
                          <div
                            className="progress-fill baseline"
                            style={{ width: `${score.baselineScore}%` }}
                            title={`Baseline: ${score.baselineScore}/100`}
                          />
                          <div
                            className="progress-fill with-skill"
                            style={{ width: `${score.withSkillScore}%` }}
                            title={`With Skill: ${score.withSkillScore}/100`}
                          />
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="efficiency-stats">
                    <div className="eff-box">
                      <span>Redukcja Tokenów</span>
                      <strong>{activeSkill.benchmarks[0]?.tokenUsage.tokenDeltaPercent}%</strong>
                    </div>
                    <div className="eff-box">
                      <span>Oszczędność Kroków</span>
                      <strong>{activeSkill.benchmarks[0]?.stepCount.stepSavingsPercent}%</strong>
                    </div>
                    <div className="eff-box">
                      <span>Środowisko Testowe</span>
                      <strong>{activeSkill.benchmarks[0]?.harness}</strong>
                    </div>
                  </div>
                </div>
              )}

              {/* Triggers Section */}
              <div className="modal-section">
                <h3>Triggery Aktywacji (Discoverability)</h3>
                <div className="full-triggers">
                  {activeSkill.triggers.map((t) => (
                    <code key={t} className="trigger-pill">{t}</code>
                  ))}
                </div>
              </div>

              {/* Test Cases */}
              {activeSkill.testCases.length > 0 && (
                <div className="modal-section">
                  <h3>Zestaw Testowy (evals.json — {activeSkill.testCases.length} przypadki)</h3>
                  <div className="test-cases-list">
                    {activeSkill.testCases.map((tc) => (
                      <div key={tc.id} className={`test-case-item ${tc.kind}`}>
                        <div className="tc-header">
                          <span className={`tc-badge ${tc.kind}`}>{tc.kind}</span>
                          <span className="tc-id">{tc.id}</span>
                        </div>
                        <p className="tc-prompt"><strong>Prompt:</strong> {tc.prompt}</p>
                        <p className="tc-outcome"><strong>Oczekiwany wynik:</strong> {tc.expectedOutcome}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Documentation Markdown preview */}
              <div className="modal-section">
                <h3>Dokumentacja (SKILL.md)</h3>
                <pre className="markdown-preview">{activeSkill.content}</pre>
              </div>
            </div>
          </div>
        </div>
      )}

      <style jsx>{`
        .skills-panel { max-width: 1200px; }
        .methodology-badge {
          display: inline-flex;
          align-items: center;
          background: rgba(0, 255, 170, 0.08);
          border: 1px solid rgba(0, 255, 170, 0.3);
          color: #00ffaa;
          padding: 6px 12px;
          border-radius: var(--radius-sm);
          font-family: var(--font-mono);
          font-size: 11px;
          font-weight: 600;
          letter-spacing: 0.04em;
        }
        .kpi-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
          gap: 16px;
          margin-bottom: 20px;
        }
        .kpi-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 16px 20px;
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .kpi-label {
          font-size: 11px;
          font-family: var(--font-mono);
          text-transform: uppercase;
          color: var(--text-muted);
          letter-spacing: 0.05em;
        }
        .kpi-value {
          font-family: var(--font-display);
          font-size: 24px;
          color: var(--text-main);
          font-weight: 700;
        }
        .kpi-sub {
          font-size: 11px;
          color: var(--text-muted);
        }
        .highlight-green .kpi-value { color: #00ffaa; }
        .highlight-cyan .kpi-value { color: #00e5ff; }
        .highlight-amber .kpi-value { color: #ffb700; }

        .sec-section {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 22px;
          margin-bottom: 16px;
        }
        .sec-filters {
          display: flex;
          gap: 14px;
          margin-bottom: 20px;
          flex-wrap: wrap;
        }
        .sec-filter {
          display: flex;
          flex-direction: column;
          gap: 6px;
          font-size: 10.5px;
          font-family: var(--font-mono);
          font-weight: 600;
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.06em;
        }
        .sec-filter select, .sec-filter input {
          min-width: 200px;
          height: 36px;
          box-sizing: border-box;
          background: var(--bg-main);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-main);
          padding: 0 10px;
          font-family: var(--font-sans);
          font-size: 13px;
        }
        .search-filter input {
          min-width: 320px;
        }

        .skills-grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
          gap: 16px;
        }
        .skill-card {
          background: var(--bg-main);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 18px;
          cursor: pointer;
          transition: border-color 0.15s ease, transform 0.15s ease;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .skill-card:hover {
          border-color: rgba(0, 255, 170, 0.4);
          transform: translateY(-2px);
        }
        .card-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          gap: 8px;
        }
        .card-title-wrap h3 {
          margin: 0;
          font-size: 14.5px;
          font-family: var(--font-display);
          color: var(--text-main);
        }
        .skill-version {
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-muted);
        }
        .verified-badge {
          background: rgba(0, 255, 170, 0.12);
          border: 1px solid rgba(0, 255, 170, 0.4);
          color: #00ffaa;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
        }
        .unverified-badge {
          background: rgba(255, 183, 0, 0.12);
          border: 1px solid rgba(255, 183, 0, 0.4);
          color: #ffb700;
          font-size: 10px;
          font-weight: 700;
          padding: 2px 6px;
          border-radius: 4px;
          text-transform: uppercase;
        }
        .card-desc {
          margin: 0;
          font-size: 12.5px;
          color: var(--text-muted);
          line-height: 1.45;
          flex-grow: 1;
        }
        .card-meta {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 8px;
        }
        .agents-chips {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }
        .agent-chip {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          color: var(--text-main);
          font-size: 10px;
          padding: 2px 6px;
          border-radius: 3px;
        }
        .lift-pill {
          font-size: 11px;
          font-family: var(--font-mono);
          color: var(--text-muted);
          white-space: nowrap;
        }
        .lift-pill strong {
          color: #00ffaa;
        }
        .triggers-wrap {
          border-top: 1px solid var(--border-subtle);
          padding-top: 8px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .triggers-label {
          font-size: 10px;
          color: var(--text-muted);
          font-family: var(--font-mono);
        }
        .triggers-list {
          display: flex;
          gap: 4px;
          flex-wrap: wrap;
        }
        .trigger-tag {
          font-size: 10px;
          background: rgba(255, 255, 255, 0.04);
          padding: 1px 4px;
          border-radius: 3px;
          color: var(--text-muted);
        }
        .trigger-more {
          font-size: 10px;
          color: var(--text-muted);
        }

        /* Modal */
        .modal-backdrop {
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
          display: flex;
          justify-content: center;
          align-items: center;
          z-index: 1000;
          padding: 20px;
        }
        .skill-modal {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          width: 100%;
          max-width: 800px;
          max-height: 85vh;
          overflow-y: auto;
          box-shadow: 0 20px 40px rgba(0, 0, 0, 0.8);
          display: flex;
          flex-direction: column;
        }
        .modal-header {
          padding: 20px;
          border-bottom: 1px solid var(--border-subtle);
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
        }
        .modal-header h2 {
          margin: 0;
          font-size: 18px;
          color: var(--text-main);
          font-family: var(--font-display);
        }
        .modal-version {
          font-size: 12px;
          font-family: var(--font-mono);
          color: var(--text-muted);
        }
        .close-btn {
          background: transparent;
          border: none;
          color: var(--text-muted);
          font-size: 18px;
          cursor: pointer;
          padding: 4px 8px;
        }
        .close-btn:hover {
          color: var(--text-main);
        }
        .modal-body {
          padding: 20px;
          display: flex;
          flex-direction: column;
          gap: 24px;
        }
        .modal-section h3 {
          font-size: 13px;
          font-family: var(--font-display);
          color: var(--text-muted);
          text-transform: uppercase;
          letter-spacing: 0.05em;
          margin: 0 0 12px;
        }
        .metrics-bars {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .metric-row {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .metric-header {
          display: flex;
          justify-content: space-between;
          font-size: 12px;
        }
        .lift-value {
          color: #00ffaa;
          font-weight: 700;
        }
        .progress-track {
          height: 8px;
          background: var(--bg-main);
          border-radius: 4px;
          position: relative;
          overflow: hidden;
          border: 1px solid var(--border-subtle);
        }
        .progress-fill {
          position: absolute;
          top: 0;
          bottom: 0;
          left: 0;
          border-radius: 4px;
        }
        .progress-fill.baseline {
          background: rgba(255, 255, 255, 0.2);
          z-index: 1;
        }
        .progress-fill.with-skill {
          background: linear-gradient(90deg, #00e5ff, #00ffaa);
          z-index: 2;
        }
        .efficiency-stats {
          display: grid;
          grid-template-columns: repeat(3, 1fr);
          gap: 12px;
          margin-top: 16px;
        }
        .eff-box {
          background: var(--bg-main);
          border: 1px solid var(--border-subtle);
          padding: 12px;
          border-radius: var(--radius-sm);
          display: flex;
          flex-direction: column;
          gap: 4px;
        }
        .eff-box span {
          font-size: 10.5px;
          color: var(--text-muted);
        }
        .eff-box strong {
          font-size: 14px;
          color: #00ffaa;
          font-family: var(--font-mono);
        }
        .full-triggers {
          display: flex;
          gap: 8px;
          flex-wrap: wrap;
        }
        .trigger-pill {
          background: var(--bg-main);
          border: 1px solid var(--border-subtle);
          padding: 4px 8px;
          border-radius: 4px;
          color: var(--text-main);
          font-size: 11px;
        }
        .test-cases-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .test-case-item {
          background: var(--bg-main);
          border: 1px solid var(--border-subtle);
          padding: 12px;
          border-radius: var(--radius-sm);
          font-size: 12px;
        }
        .tc-header {
          display: flex;
          justify-content: space-between;
          margin-bottom: 6px;
        }
        .tc-badge {
          font-size: 9.5px;
          font-weight: 700;
          text-transform: uppercase;
          padding: 1px 5px;
          border-radius: 3px;
        }
        .tc-badge.explicit { background: rgba(0, 229, 255, 0.15); color: #00e5ff; }
        .tc-badge.implicit { background: rgba(255, 183, 0, 0.15); color: #ffb700; }
        .tc-badge.negative { background: rgba(255, 77, 77, 0.15); color: #ff4d4d; }
        .tc-badge.contextual { background: rgba(180, 100, 255, 0.15); color: #b464ff; }
        .tc-id { font-family: var(--font-mono); color: var(--text-muted); font-size: 10px; }
        .tc-prompt, .tc-outcome { margin: 4px 0 0; line-height: 1.4; color: var(--text-muted); }
        .tc-prompt strong, .tc-outcome strong { color: var(--text-main); }
        .markdown-preview {
          background: var(--bg-main);
          border: 1px solid var(--border-subtle);
          padding: 14px;
          border-radius: var(--radius-sm);
          font-family: var(--font-mono);
          font-size: 11.5px;
          color: var(--text-main);
          white-space: pre-wrap;
          overflow-x: auto;
          max-height: 240px;
        }
      `}</style>
    </div>
  );
}
