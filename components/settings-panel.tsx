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
    if (next !== confirm) { setMsg({ ok: false, text: "Nowe hasła się nie zgadzają." }); return; }
    setBusy(true);
    try {
      const r = await fetch("/api/account/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current, next }),
      });
      const d = await r.json().catch(() => ({}));
      if (r.ok) {
        setMsg({ ok: true, text: "Hasło zmienione. Aktywne po kilku sekundach (Authelia przeładowuje plik)." });
        setCurrent(""); setNext(""); setConfirm("");
      } else {
        setMsg({ ok: false, text: d.error || "Błąd zmiany hasła." });
      }
    } catch {
      setMsg({ ok: false, text: "Błąd sieci." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-panel">
      <div className="section-head">
        <div><p className="eyebrow">USTAWIENIA</p><h2>Konto i bezpieczeństwo</h2></div>
      </div>
      <div className="settings-card">
        <h3>Zmień hasło</h3>
        <p className="settings-hint">
          Hasło jest przechowywane jako jednokierunkowy hash argon2id w magazynie Authelii — nie da się go odszyfrować.
          Po zmianie zaloguj się ponownie.
        </p>
        <form onSubmit={submit} className="settings-form">
          <label>Obecne hasło
            <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
          </label>
          <label>Nowe hasło (min. 12 znaków)
            <input type="password" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={12} required />
          </label>
          <label>Powtórz nowe hasło
            <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={12} required />
          </label>
          {msg && <p className={msg.ok ? "settings-ok" : "settings-err"}>{msg.text}</p>}
          <button className="action-btn primary" disabled={busy}>{busy ? "Przetwarzanie…" : "Zmień hasło"}</button>
        </form>
      </div>
    </section>
  );
}
