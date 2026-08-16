"use client";

import { useState } from "react";
import type { AgentActivityCell } from "@/lib/trends";

const DAYS = 84; // 12 tygodni

function cellColor(n: number): string {
  if (n === 0) return "var(--hm0)";
  if (n <= 2) return "var(--hm1)";
  if (n <= 5) return "var(--hm2)";
  return "var(--hm3)";
}

/** Okno dni [today-days+1 .. today] jako lista ISO dat (deterministyczne dla danego `todayISO`). */
export function dayWindow(todayISO: string, days = DAYS): string[] {
  const ref = new Date(`${todayISO}T00:00:00Z`).getTime();
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    out.push(new Date(ref - i * 86400_000).toISOString().slice(0, 10));
  }
  return out;
}

/** Pasek aktywności per agent (84 dni) — styl heatmapy GitHuba, czysty CSS. */
export function ActivityHeatmap({ data, agents, today }: {
  data: AgentActivityCell[];
  agents: { slug: string; name: string }[];
  /** Referencyjna data (ISO) zakończenia okna. Domyślnie bieżąca, zamrożona raz przy montażu. */
  today?: string;
}) {
  const [refDate] = useState(() => today ?? new Date().toISOString().slice(0, 10));
  const days = dayWindow(refDate);

  const byAgent = new Map<string, Map<string, number>>();
  for (const c of data) {
    let m = byAgent.get(c.agent);
    if (!m) { m = new Map(); byAgent.set(c.agent, m); }
    m.set(c.date, c.count);
  }

  const rows = agents.filter((a) => byAgent.has(a.slug));
  if (!rows.length) return <p className="heatmap-empty">Brak aktywności agentów w ostatnich 12 tygodniach.</p>;

  return (
    <div className="heatmap" role="img" aria-label="Aktywność agentów (84 dni)">
      {rows.map((a) => {
        const m = byAgent.get(a.slug)!;
        const total = [...m.values()].reduce((s, n) => s + n, 0);
        return (
          <div key={a.slug} className="heatmap-row">
            <div className="heatmap-label"><span>{a.name}</span><em>{total}</em></div>
            <div className="heatmap-cells">
              {days.map((d) => {
                const n = m.get(d) || 0;
                return <div key={d} className="hm-cell" style={{ background: cellColor(n) }} title={`${a.name} · ${d} · ${n} zdarzeń`} />;
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
