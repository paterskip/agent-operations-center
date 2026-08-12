"use client";

import { useEffect, useState } from "react";

type AuditEntry = { id: number; actor: string; action: string; target: string | null; detail: string | null; ip: string | null; createdAt: number };
type AuditData = { log: AuditEntry[]; currentIp: string };

function fmtTs(ts: number) {
  return new Date(ts * 1000).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "medium" });
}

function actionTone(action: string): "bad" | "good" {
  return action.includes("failed") || action.includes("error") || action.includes("reject") || action.includes("blocked") ? "bad" : "good";
}

export default function SecurityPanel() {
  const [data, setData] = useState<AuditData | null>(null);
  const [logError, setLogError] = useState("");

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

  return <div className="security-panel">
    <header className="topbar"><div><p className="eyebrow">AUDYT</p><h1>Dziennik audytu</h1></div><div className="top-actions">{data && <span className="updated">Twój adres IP: <code>{data.currentIp}</code></span>}</div></header>

    {logError && <p className="sec-error">{logError}</p>}

    <section className="sec-section">
      <h2>Wszystkie akcje w panelu <span>{data?.log.length || 0} wpisów</span></h2>
      <div className="sec-table-wrap">
        <table className="sec-table">
          <thead><tr><th>Data</th><th>Aktor</th><th>Akcja</th><th>Szczegóły</th><th>IP</th></tr></thead>
          <tbody>
            {data?.log.map((entry) => <tr key={entry.id}>
              <td>{fmtTs(entry.createdAt)}</td>
              <td>{entry.actor}</td>
              <td><span className={`sec-action ${actionTone(entry.action)}`}>{entry.action}</span></td>
              <td>{entry.detail || "—"}</td>
              <td><code>{entry.ip || "—"}</code></td>
            </tr>)}
            {data && !data.log.length && <tr><td colSpan={5} className="sec-empty">Brak wpisów.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="sec-note">Zmiana hasła nie jest obsługiwana przez panel — to zadanie Authelii (reset w portalu lub <code>docker exec agent-operations-center-authelia-1 authelia admin user password &lt;user&gt;</code>). Authelia egzekwuje też ochronę przed brute-force.</p>
    </section>

    <style jsx>{`
      .security-panel { max-width: 1000px; }
      .sec-section { background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
      .sec-section h2 { font-size: 15px; margin: 0 0 14px; }
      .sec-section h2 span { color: var(--muted); font-size: 12px; margin-left: 8px; }
      .sec-error { color: var(--red); font-size: 12px; margin: 0 0 12px; }
      .sec-note { color: #8c9aab; font-size: 11px; line-height: 1.7; margin: 14px 0 0; }
      .sec-note code { color: #c0c9d4; }
      .sec-table-wrap { overflow: auto; -webkit-overflow-scrolling: touch; }
      .sec-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .sec-table th { text-align: left; padding: 10px 10px; color: #8c9aab; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid var(--line); }
      .sec-table td { padding: 10px; border-bottom: 1px solid #1a222e; color: #c0c9d4; }
      .sec-table code { font-size: 11px; color: var(--muted); }
      .sec-action { font: 700 8px ui-monospace,monospace; text-transform: uppercase; padding: 3px 6px; border-radius: 5px; }
      .sec-action.good { color: var(--green); background: #10261f; }
      .sec-action.bad { color: var(--red); background: #2a151b; }
      .sec-empty { text-align: center; color: var(--muted); padding: 30px; }
      .updated { font-size: 12px; color: var(--muted); }
      @media (max-width: 760px) {
        .sec-table { font-size: 11px; }
        .sec-table th, .sec-table td { padding: 8px 6px; }
      }
    `}</style>
  </div>;
}
