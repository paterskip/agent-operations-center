"use client";

import type { AgentActivityCell } from "@/lib/trends";

const DAYS = 84; // 12 tygodni

function cellColor(n: number): string {
  if (n === 0) return "var(--hm0)";
  if (n <= 2) return "var(--hm1)";
  if (n <= 5) return "var(--hm2)";
  return "var(--hm3)";
}

/** Pasek aktywności per agent (84 dni) — styl heatmapy GitHuba, czysty CSS. */
export function ActivityHeatmap({ data, agents }: { data: AgentActivityCell[]; agents: { slug: string; name: string }[] }) {
  const byAgent = new Map<string, Map<string, number>>();
  for (const c of data) {
    let m = byAgent.get(c.agent);
    if (!m) { m = new Map(); byAgent.set(c.agent, m); }
    m.set(c.date, c.count);
  }

  const days: string[] = [];
  for (let i = DAYS - 1; i >= 0; i--) {
    // eslint-disable-next-line react-hooks/purity -- okno 84 dni jest stabilne w ciągu doby; liczone raz przy montażu
    days.push(new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10));
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
