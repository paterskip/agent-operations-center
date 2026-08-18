"use client";

import { useEffect, useMemo, useState } from "react";

type AuditEntry = { id: number; actor: string; action: string; target: string | null; detail: string | null; ip: string | null; createdAt: number };
type AuditData = { log: AuditEntry[]; currentIp: string };

function fmtTs(ts: number) {
  return new Date(ts * 1000).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "medium" });
}

function actionTone(action: string): "bad" | "good" {
  return action.includes("failed") || action.includes("error") || action.includes("reject") || action.includes("blocked") ? "bad" : "good";
}

const actorLabel: Record<string, string> = { ceo: "CEO", broker: "Hermes (broker)" };

export default function SecurityPanel() {
  const [data, setData] = useState<AuditData | null>(null);
  const [logError, setLogError] = useState("");
  const [actorFilter, setActorFilter] = useState("all");
  const [toneFilter, setToneFilter] = useState<"all" | "good" | "bad">("all");

  useEffect(() => {
    let active = true;
    fetch("/api/account/security-log", { cache: "no-store" })
      .then((r) => {
        if (!active) return null;
        if (!r.ok) { setLogError("Nie udało się pobrać dziennika audytu."); return null; }
        return r.json();
      })
      .then((payload) => { if (active && payload) { setData(payload as AuditData); setLogError(""); } })
      .catch(() => { if (active) setLogError("Błąd połączenia."); });
    return () => { active = false; };
  }, []);

  const actors = useMemo(() => [...new Set((data?.log || []).map((e) => e.actor))], [data]);
  const filtered = useMemo(() => (data?.log || []).filter((e) =>
    (actorFilter === "all" || e.actor === actorFilter) && (toneFilter === "all" || actionTone(e.action) === toneFilter)
  ), [data, actorFilter, toneFilter]);

  return <div className="security-panel">
    <header className="topbar">
      <div><p className="eyebrow">AUDYT</p><h1>Dziennik audytu</h1></div>
      <div className="top-actions">
        <a href="/api/audit/export?format=csv&days=30" download className="digest-top-btn" title="Pobierz pełny dziennik audytu w formacie CSV">📥 Pobierz CSV</a>
        <a href="/api/audit/export?format=json&days=30" download className="digest-top-btn" title="Pobierz pełny dziennik audytu w formacie JSON">📥 Pobierz JSON</a>
        {data && <span className="ip-status-badge" title="Twój wykryty publiczny adres IP">IP: <strong>{data.currentIp}</strong></span>}
      </div>
    </header>

    {logError && <p className="sec-error">{logError}</p>}

    <section className="sec-section">
      <div className="sec-filters">
        <label className="sec-filter">Aktor
          <select value={actorFilter} onChange={(e) => setActorFilter(e.target.value)}>
            <option value="all">Wszyscy</option>
            {actors.map((a) => <option key={a} value={a}>{actorLabel[a] || a}</option>)}
          </select>
        </label>
        <label className="sec-filter">Status
          <select value={toneFilter} onChange={(e) => setToneFilter(e.target.value as "all" | "good" | "bad")}>
            <option value="all">Wszystkie</option>
            <option value="good">Poprawne</option>
            <option value="bad">Błędy / odmowy</option>
          </select>
        </label>
      </div>
      <h2>Wszystkie akcje w panelu <span>{filtered.length}{actorFilter !== "all" || toneFilter !== "all" ? ` / ${data?.log.length || 0}` : ""} wpisów</span></h2>
      <div className="sec-table-wrap">
        <table className="sec-table">
          <thead><tr><th>Data</th><th>Aktor</th><th>Akcja</th><th>Szczegóły</th><th>IP</th></tr></thead>
          <tbody>
            {filtered.map((entry) => <tr key={entry.id}>
              <td>{fmtTs(entry.createdAt)}</td>
              <td>{actorLabel[entry.actor] || entry.actor}</td>
              <td><span className={`sec-action ${actionTone(entry.action)}`}>{entry.action}</span></td>
              <td>{entry.detail || "—"}</td>
              <td><code>{entry.ip || "—"}</code></td>
            </tr>)}
            {data && !filtered.length && <tr><td colSpan={5} className="sec-empty">Brak wpisów.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="sec-note">Zmiana hasła nie jest obsługiwana przez panel — to zadanie Authelii (reset w portalu lub <code>docker exec agent-operations-center-authelia-1 authelia admin user password &lt;user&gt;</code>). Authelia egzekwuje też ochronę przed brute-force.</p>
    </section>

    <style jsx>{`
      .security-panel { max-width: 1000px; }
      .sec-section { background: var(--bg-surface); border: 1px solid var(--border-subtle); border-radius: var(--radius-sm); padding: 22px; margin-bottom: 16px; }
      .sec-section h2 { font-family: var(--font-display); font-size: 15px; font-weight: 700; margin: 0 0 16px; color: var(--text-main); }
      .sec-section h2 span { color: var(--text-muted); font-size: 12px; font-family: var(--font-mono); font-weight: 400; margin-left: 8px; }
      .sec-error { color: var(--accent-orange); font-size: 12px; margin: 0 0 12px; }
      .sec-filters { display: flex; gap: 14px; margin-bottom: 20px; flex-wrap: wrap; }
      .sec-filter { display: flex; flex-direction: column; gap: 6px; font-size: 10.5px; font-family: var(--font-mono); font-weight: 600; color: var(--text-muted); text-transform: uppercase; letter-spacing: .06em; }
      .sec-filter select {
        min-width: 170px;
        height: 36px;
        box-sizing: border-box;
        appearance: none;
        -webkit-appearance: none;
        background: #090B0D url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%237D8EA3' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") no-repeat right 10px center;
        border: 1px solid var(--border-subtle);
        border-radius: var(--radius-sm);
        color: var(--text-main);
        padding: 0 30px 0 12px;
        font-size: 12px;
        font-family: inherit;
        outline: none;
        cursor: pointer;
        transition: all 0.15s ease;
      }
      .sec-filter select:hover { border-color: var(--border-strong); }
      .sec-filter select:focus { border-color: var(--accent-lime); box-shadow: 0 0 0 2px rgba(212, 255, 0, 0.15); }
      .sec-note { color: var(--text-muted); font-size: 11.5px; line-height: 1.65; margin: 16px 0 0; }
      .sec-note code { color: var(--accent-lime); font-size: 11px; }
      .sec-table-wrap { overflow-x: auto; -webkit-overflow-scrolling: touch; border-radius: var(--radius-xs); }
      .sec-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
      .sec-table th { text-align: left; padding: 10px 12px; color: var(--text-muted); font-size: 10px; font-family: var(--font-mono); font-weight: 700; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid var(--border-subtle); }
      .sec-table td { padding: 11px 12px; border-bottom: 1px solid var(--border-subtle); color: var(--text-secondary); }
      .sec-table code { font-size: 11.5px; color: var(--text-muted); font-family: var(--font-mono); }
      .sec-action { font: 700 9px var(--font-mono); text-transform: uppercase; padding: 3px 7px; border-radius: var(--radius-xs); display: inline-block; letter-spacing: 0.04em; }
      .sec-action.good { color: var(--accent-lime); background: rgba(212, 255, 0, 0.08); border: 1px solid rgba(212, 255, 0, 0.2); }
      .sec-action.bad { color: var(--accent-orange); background: rgba(255, 77, 0, 0.08); border: 1px solid rgba(255, 77, 0, 0.25); }
      .sec-empty { text-align: center; color: var(--text-muted); padding: 36px; font-style: italic; }
      @media (max-width: 760px) {
        .sec-table { font-size: 11.5px; }
        .sec-table th, .sec-table td { padding: 8px 8px; }
        .sec-filters { gap: 10px; }
        .sec-filter { flex: 1 1 100%; }
        .sec-filter select { width: 100%; min-width: 0; }
      }
    `}</style>
  </div>;
}
