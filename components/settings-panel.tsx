"use client";

import { useState } from "react";

export default function SettingsPanel() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    if (next !== confirm) {
      setMsg({ ok: false, text: "Nowe hasła nie są identyczne." });
      return;
    }
    if (next.length < 12) {
      setMsg({ ok: false, text: "Nowe hasło musi mieć co najmniej 12 znaków." });
      return;
    }
    setBusy(true);
    try {
      const r = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; ok?: boolean };
      if (r.ok) {
        setMsg({
          ok: true,
          text: "Hasło zostało pomyślnie zmienione. Authelia przeładowała konfigurację.",
        });
        setCurrent("");
        setNext("");
        setConfirm("");
      } else {
        setMsg({ ok: false, text: d.error || "Nie udało się zmienić hasła." });
      }
    } catch {
      setMsg({ ok: false, text: "Błąd połączenia z serwerem." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="settings-container">
      <header className="topbar">
        <div>
          <p className="eyebrow">SYSTEM & SECURITY</p>
          <h1>Ustawienia konta</h1>
        </div>
        <div className="top-actions">
          <span className="ip-status-badge" title="Status bramy uwierzytelniania">
            Authelia <strong>SSO Active</strong>
          </span>
        </div>
      </header>

      <div className="settings-grid">
        {/* Form Card */}
        <section className="settings-card form-card">
          <div className="settings-card-head">
            <h2>Zmiana hasła głównego</h2>
            <p>Zaktualizuj swoje poświadczenia logowania do panelu operacyjnego.</p>
          </div>

          <form onSubmit={submit} className="settings-form">
            <label className="settings-label">
              <span>Obecne hasło</span>
              <input
                type="password"
                value={current}
                onChange={(e) => setCurrent(e.target.value)}
                autoComplete="current-password"
                placeholder="Wpisz dotychczasowe hasło"
                required
              />
            </label>

            <label className="settings-label">
              <span>Nowe hasło</span>
              <input
                type="password"
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                placeholder="Minimum 12 znaków"
                required
              />
            </label>

            <label className="settings-label">
              <span>Powtórz nowe hasło</span>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                minLength={12}
                placeholder="Powtórz nowe hasło"
                required
              />
            </label>

            {msg && (
              <div className={`settings-alert ${msg.ok ? "success" : "error"}`}>
                <span className="alert-icon">{msg.ok ? "✓" : "!"}</span>
                <span>{msg.text}</span>
              </div>
            )}

            <div className="settings-actions">
              <button
                type="submit"
                className="settings-submit-btn"
                disabled={busy || !current || !next || !confirm}
              >
                {busy ? "Zapisywanie…" : "Zmień hasło"}
              </button>
            </div>
          </form>
        </section>

        {/* Security Meta Details Card */}
        <aside className="settings-card info-card">
          <div className="settings-card-head">
            <h2>Architektura bezpieczeństwa</h2>
            <p>Zasady ochrony i parametry kryptograficzne sesji.</p>
          </div>

          <div className="security-specs-list">
            <div className="spec-row">
              <div className="spec-icon">🔒</div>
              <div>
                <strong>Algorytm haszowania</strong>
                <p>Argon2id (m=128MB, t=5, p=4, RFC 9106)</p>
              </div>
            </div>

            <div className="spec-row">
              <div className="spec-icon">🛡️</div>
              <div>
                <strong>Brama uwierzytelniania</strong>
                <p>Authelia ForwardAuth z ochroną brute-force IP</p>
              </div>
            </div>

            <div className="spec-row">
              <div className="spec-icon">⏱️</div>
              <div>
                <strong>Auto-Lock przy bezczynności</strong>
                <p>10 minut braku aktywności (ochrona stacji roboczej)</p>
              </div>
            </div>

            <div className="spec-row">
              <div className="spec-icon">📋</div>
              <div>
                <strong>Dziennik audytu operacji</strong>
                <p>Rejestracja wszystkich decyzji i logowań z adresem IP</p>
              </div>
            </div>
          </div>
        </aside>
      </div>

      <style jsx>{`
        .settings-container {
          max-width: 1040px;
        }

        .settings-grid {
          display: grid;
          grid-template-columns: minmax(0, 1.2fr) minmax(0, 0.8fr);
          gap: 20px;
          align-items: start;
        }

        .settings-card {
          background: var(--bg-surface);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          padding: 24px;
        }

        .settings-card-head h2 {
          font-family: var(--font-display);
          font-size: 16px;
          font-weight: 700;
          color: var(--text-main);
          margin: 0 0 6px;
        }

        .settings-card-head p {
          font-size: 12.5px;
          color: var(--text-muted);
          margin: 0 0 20px;
          line-height: 1.45;
        }

        .settings-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .settings-label {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .settings-label span {
          font-family: var(--font-mono);
          font-size: 10.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.06em;
          color: var(--text-secondary);
        }

        .settings-label input {
          width: 100%;
          height: 38px;
          box-sizing: border-box;
          padding: 0 12px;
          background: #090B0D;
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-sm);
          color: var(--text-main);
          font-size: 13px;
          font-family: inherit;
          outline: none;
          transition: all 0.15s ease;
        }

        .settings-label input:hover {
          border-color: var(--border-strong);
        }

        .settings-label input:focus {
          border-color: var(--accent-lime);
          box-shadow: 0 0 0 2px rgba(212, 255, 0, 0.15);
        }

        .settings-label input::placeholder {
          color: var(--text-muted);
          font-size: 12px;
        }

        .settings-alert {
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 10px 14px;
          border-radius: var(--radius-xs);
          font-size: 12px;
          line-height: 1.4;
        }

        .settings-alert.success {
          background: rgba(212, 255, 0, 0.08);
          border: 1px solid rgba(212, 255, 0, 0.25);
          color: var(--accent-lime);
        }

        .settings-alert.error {
          background: rgba(255, 77, 0, 0.08);
          border: 1px solid rgba(255, 77, 0, 0.25);
          color: var(--accent-orange);
        }

        .alert-icon {
          font-family: var(--font-mono);
          font-weight: 700;
          font-size: 13px;
        }

        .settings-actions {
          margin-top: 6px;
          display: flex;
          justify-content: flex-start;
        }

        .settings-submit-btn {
          height: 36px;
          box-sizing: border-box;
          padding: 0 18px;
          background: var(--accent-lime);
          color: var(--text-contrast);
          font-family: var(--font-display);
          font-size: 11.5px;
          font-weight: 700;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          border: 1px solid var(--accent-lime);
          border-radius: var(--radius-sm);
          cursor: pointer;
          transition: all 0.15s ease;
          display: inline-flex;
          align-items: center;
          justify-content: center;
        }

        .settings-submit-btn:hover:not(:disabled) {
          box-shadow: 0 4px 16px rgba(212, 255, 0, 0.3);
          transform: translateY(-1px);
        }

        .settings-submit-btn:disabled {
          opacity: 0.45;
          cursor: not-allowed;
          filter: grayscale(0.5);
        }

        .security-specs-list {
          display: flex;
          flex-direction: column;
          gap: 14px;
        }

        .spec-row {
          display: flex;
          gap: 12px;
          align-items: flex-start;
          padding: 10px 12px;
          background: rgba(255, 255, 255, 0.02);
          border: 1px solid var(--border-subtle);
          border-radius: var(--radius-xs);
        }

        .spec-icon {
          font-size: 15px;
          line-height: 1.3;
          flex-shrink: 0;
        }

        .spec-row strong {
          display: block;
          font-size: 12px;
          color: var(--text-main);
          margin-bottom: 2px;
        }

        .spec-row p {
          margin: 0;
          font-size: 11.5px;
          color: var(--text-muted);
          line-height: 1.4;
        }

        @media (max-width: 820px) {
          .settings-grid {
            grid-template-columns: 1fr;
          }
          .settings-card {
            padding: 18px;
          }
        }
      `}</style>
    </div>
  );
}
