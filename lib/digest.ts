import type { DashboardSnapshot } from "./types";
import type { AgentScorecardRow } from "./scorecard";

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h ${m}m`;
}

export function generateDailyDigest(
  snapshot: DashboardSnapshot,
  scorecard: AgentScorecardRow[] = [],
  now = Date.now()
): string {
  const dateStr = new Intl.DateTimeFormat("pl-PL", {
    dateStyle: "full",
    timeStyle: "short",
  }).format(new Date(now));

  const tasks = snapshot.tasks;
  const running = tasks.filter((t) => t.status === "running");
  const review = tasks.filter((t) => t.status === "review");
  const blocked = tasks.filter((t) => t.status === "blocked");
  const scheduled = tasks.filter((t) => t.status === "scheduled");
  const done = tasks.filter((t) => t.status === "done");
  const nowSec = Math.floor(now / 1000);

  const lines: string[] = [
    `# 🛰️ Agent Operations Center — Raport Dzienny`,
    `*Wygenerowano: ${dateStr}*\n`,
    `## 📊 Status Ogólny`,
    `- **Aktywne zadania w toku:** ${running.length}`,
    `- **Oczekujące na review:** ${review.length}`,
    `- **Wymagające decyzji / Zablokowane:** ${blocked.length + scheduled.length}`,
    `- **Ukończone (ogółem na tablicy):** ${done.length}`,
    `- **Wszyscy agenci online:** ${snapshot.agents.length} (${snapshot.agents.filter((a) => a.status === "working").length} pracujących)`,
    "",
  ];

  // 1. Wymagające uwagi
  const attention = [...blocked, ...scheduled];
  if (attention.length > 0) {
    lines.push(`## ⚠️ Wymagające uwagi CEO (${attention.length})`);
    for (const t of attention) {
      const age = nowSec - (t.startedAt || t.createdAt);
      const reason = t.comments?.[t.comments.length - 1]?.body || "Brak komentarza";
      lines.push(`- **\`${t.id}\` [${t.status.toUpperCase()}]** ${t.title} (${t.assignee || "nieprzypisany"}, czas: ${formatDuration(age)})`);
      if (t.status === "blocked") {
        lines.push(`  > *Powód:* ${reason.slice(0, 160)}`);
      }
    }
    lines.push("");
  }

  // 2. Zadania w toku
  if (running.length > 0) {
    lines.push(`## 🚀 Aktualnie w realizacji (${running.length})`);
    for (const t of running) {
      const age = nowSec - (t.startedAt || t.createdAt);
      lines.push(`- **\`${t.id}\`** ${t.title} — *${t.assignee || "agent"}* (czas: ${formatDuration(age)})`);
    }
    lines.push("");
  }

  // 3. Do weryfikacji / Review
  if (review.length > 0) {
    lines.push(`## 🔍 Gotowe do review (${review.length})`);
    for (const t of review) {
      lines.push(`- **\`${t.id}\`** ${t.title} — *${t.assignee || "agent"}*`);
    }
    lines.push("");
  }

  // 4. Wyniki agentów & koszty
  if (scorecard.length > 0) {
    lines.push(`## 📈 Efektywność Agentów (30 dni)`);
    lines.push(`| Agent / Rola | Ukończone (7d/30d) | Zablokowane | Rework | Tokeny / Koszt |`);
    lines.push(`| :--- | :--- | :--- | :--- | :--- |`);
    for (const row of scorecard) {
      const costStr = row.cost30 != null ? (row.cost30 > 0 ? `$${row.cost30.toFixed(2)}` : `${(row.tokens30 / 1e6).toFixed(1)}M tok`) : "—";
      lines.push(`| **${row.name}** | ${row.done7} / ${row.done30} | ${row.blocked30} | ${row.rework30} | ${costStr} |`);
    }
    lines.push("");
  }

  lines.push(`---`);
  lines.push(`*Raport wygenerowany automatycznie przez Agent Operations Center.*`);

  return lines.join("\n");
}
