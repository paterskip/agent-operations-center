"use client";

import { useCallback, useEffect, useState } from "react";

type SecurityData = {
  log: { id: number; actor: string; action: string; target: string | null; detail: string | null; ip: string | null; createdAt: number }[];
  failedAttempts: number;
  nearLimit: boolean;
  currentIp: string;
  limits: { maxRetries: number; windowMinutes: number; banHours: number };
};

function fmtTs(ts: number) {
  return new Date(ts * 1000).toLocaleString("pl-PL", { dateStyle: "medium", timeStyle: "medium" });
}

export default function SecurityPanel() {
  const [currentPw, setCurrentPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [pwError, setPwError] = useState("");
  const [pwSuccess, setPwSuccess] = useState("");
  const [busy, setBusy] = useState(false);
  const [data, setData] = useState<SecurityData | null>(null);
  const [logError, setLogError] = useState("");

  const loadLog = useCallback(async () => {
    try {
      const r = await fetch("/api/account/security-log", { cache: "no-store" });
      if (!r.ok) { setLogError("Nie udało się pobrać logów."); return; }
      setData(await r.json() as SecurityData);
      setLogError("");
    } catch { setLogError("Błąd połączenia."); }
  }, []);

  useEffect(() => { void loadLog(); }, [loadLog]);

  function clientValidate(): string | null {
    if (newPw.length < 12) return "Min. 12 znaków.";
    if (!/[A-Z]/.test(newPw)) return "Potrzebna wielka litera.";
    if (!/[0-9]/.test(newPw)) return "Potrzebna cyfra.";
    if (!/[^A-Za-z0-9]/.test(newPw)) return "Potrzebny znak specjalny.";
    if (newPw !== confirmPw) return "Hasła nie są identyczne.";
    if (currentPw === newPw) return "Nowe hasło musi być inne.";
    return null;
  }

  async function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setPwError(""); setPwSuccess("");
    const err = clientValidate();
    if (err) { setPwError(err); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword: currentPw, newPassword: newPw }),
      });
      const j = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok) throw new Error(j.error || "Błąd");
      setPwSuccess("Hasło zmienione pomyślnie.");
      setCurrentPw(""); setNewPw(""); setConfirmPw("");
      void loadLog();
    } catch (e) { setPwError(e instanceof Error ? e.message : "Błąd"); }
    finally { setBusy(false); }
  }

  return <div className="security-panel">
    <header className="topbar"><div><p className="eyebrow">BEZPIECZEŃSTWO</p><h1>Security Center</h1></div></header>

    {/* Password Change */}
    <section className="sec-section">
      <h2>🔑 Zmiana hasła</h2>
      <form onSubmit={handleSubmit} className="sec-form">
        <label><span>Obecne hasło</span>
          <input type="password" value={currentPw} onChange={(e) => setCurrentPw(e.target.value)} required minLength={1} autoComplete="current-password" />
        </label>
        <label><span>Nowe hasło</span>
          <input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} required minLength={12} autoComplete="new-password" placeholder="min. 12 znaków, A-Z, 0-9, znak specjalny" />
        </label>
        <label><span>Powtórz nowe hasło</span>
          <input type="password" value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} required minLength={12} autoComplete="new-password" />
        </label>
        {pwError && <p className="sec-error">{pwError}</p>}
        {pwSuccess && <p className="sec-success">{pwSuccess}</p>}
        <button type="submit" disabled={busy} className="sec-btn primary">{busy ? "Zmiana…" : "Zmień hasło"}</button>
      </form>
    </section>

    {/* Status */}
    {data && <section className="sec-section">
      <h2>📊 Status bezpieczeństwa</h2>
      <div className="sec-status-grid">
        <article><span>Adres IP</span><strong>{data.currentIp}</strong></article>
        <article><span>Nieudane próby</span><strong>{data.failedAttempts}<small> / {data.limits.maxRetries}</small></strong></article>
        <article><span>Okno blokady</span><strong>{data.limits.windowMinutes} min</strong></article>
        <article><span>Ban po przekroczeniu</span><strong>{data.limits.banHours} godz.</strong></article>
      </div>
      {data.nearLimit && <div className="sec-alert">⚠️ Blisko limitu nieudanych prób ({data.failedAttempts}/{data.limits.maxRetries}). Kolejna błędna próba zablokuje dostęp na {data.limits.banHours} godz.</div>}
    </section>}

    {/* History */}
    {data && <section className="sec-section">
      <h2>📜 Historia bezpieczeństwa <span>{data.log.length} wpisów</span></h2>
      {logError && <p className="sec-error">{logError}</p>}
      <div className="sec-table-wrap">
        <table className="sec-table">
          <thead><tr><th>Data</th><th>IP</th><th>Akcja</th><th>Szczegóły</th></tr></thead>
          <tbody>
            {data.log.map((entry) => <tr key={entry.id}>
              <td>{fmtTs(entry.createdAt)}</td>
              <td><code>{entry.ip || "—"}</code></td>
              <td><span className={`sec-action ${entry.action.includes("failed") || entry.action.includes("error") ? "bad" : "good"}`}>{entry.action}</span></td>
              <td>{entry.detail || "—"}</td>
            </tr>)}
            {!data.log.length && <tr><td colSpan={4} className="sec-empty">Brak wpisów.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>}

    <style jsx>{`
      .security-panel { max-width: 900px; }
      .sec-section { background: var(--panel2); border: 1px solid var(--line); border-radius: var(--radius); padding: 20px; margin-bottom: 16px; }
      .sec-section h2 { font-size: 15px; margin: 0 0 14px; }
      .sec-section h2 span { color: var(--muted); font-size: 12px; margin-left: 8px; }
      .sec-form { display: grid; gap: 12px; max-width: 420px; }
      .sec-form label { display: grid; gap: 5px; }
      .sec-form label span { font-size: 10px; color: #8c9aab; text-transform: uppercase; letter-spacing: .06em; }
      .sec-form input { width: 100%; border: 1px solid #273348; background: #101722; color: var(--text); border-radius: 9px; padding: 12px 14px; outline: none; min-height: 44px; }
      .sec-form input:focus { border-color: var(--blue); box-shadow: 0 0 0 2px #56a8ff22; }
      .sec-error { color: var(--red); font-size: 12px; margin: 0; }
      .sec-success { color: var(--green); font-size: 12px; margin: 0; }
      .sec-btn { border-radius: 9px; padding: 12px 20px; cursor: pointer; font-size: 13px; min-height: 44px; border: 1px solid #344156; background: #141c28; color: var(--text); }
      .sec-btn.primary { border-color: #3f78b2; background: linear-gradient(135deg,#286baa,#6755c9); }
      .sec-btn:disabled { opacity: .55; cursor: not-allowed; }
      .sec-status-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 10px; }
      .sec-status-grid article { padding: 14px; background: #111722; border: 1px solid var(--line); border-radius: 10px; }
      .sec-status-grid span { color: #8a99ac; font-size: 11px; display: block; }
      .sec-status-grid strong { display: block; font-size: 24px; margin-top: 6px; }
      .sec-status-grid strong small { font-size: 13px; color: #607086; }
      .sec-alert { background: #2a1f0d; border: 1px solid #725927; color: var(--amber); border-radius: 9px; padding: 12px 14px; font-size: 12px; margin-top: 12px; }
      .sec-table-wrap { overflow: auto; -webkit-overflow-scrolling: touch; }
      .sec-table { width: 100%; border-collapse: collapse; font-size: 12px; }
      .sec-table th { text-align: left; padding: 10px 10px; color: #8c9aab; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; border-bottom: 1px solid var(--line); }
      .sec-table td { padding: 10px; border-bottom: 1px solid #1a222e; color: #c0c9d4; }
      .sec-table code { font-size: 11px; color: var(--muted); }
      .sec-action { font: 700 8px ui-monospace,monospace; text-transform: uppercase; padding: 3px 6px; border-radius: 5px; }
      .sec-action.good { color: var(--green); background: #10261f; }
      .sec-action.bad { color: var(--red); background: #2a151b; }
      .sec-empty { text-align: center; color: var(--muted); padding: 30px; }
      @media (max-width: 760px) {
        .sec-status-grid { grid-template-columns: 1fr 1fr; }
        .sec-table { font-size: 11px; }
        .sec-table th, .sec-table td { padding: 8px 6px; }
      }
    `}</style>
  </div>;
}
