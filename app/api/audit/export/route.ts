import { NextRequest, NextResponse } from "next/server";
import { getAuditLog, listDecisions } from "@/lib/state";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const format = url.searchParams.get("format") === "csv" ? "csv" : "json";
  const days = Math.min(Math.max(Number(url.searchParams.get("days") || 30), 1), 90);
  const sinceSec = Math.floor(Date.now() / 1000) - days * 86400;

  const logs = getAuditLog(2000, sinceSec);
  const decisions = listDecisions();

  if (format === "csv") {
    const headers = ["type", "id", "actor_or_board", "action", "target_or_task", "detail_or_comment", "ip_or_status", "created_at"];
    const rows: string[][] = [headers];

    for (const l of logs) {
      rows.push([
        "audit",
        String(l.id),
        escapeCsv(l.actor),
        escapeCsv(l.action),
        escapeCsv(l.target || ""),
        escapeCsv(l.detail || ""),
        escapeCsv(l.ip || ""),
        new Date(l.createdAt * 1000).toISOString(),
      ]);
    }

    for (const d of decisions) {
      if (d.createdAt >= sinceSec) {
        rows.push([
          "decision",
          d.id,
          escapeCsv(d.board),
          escapeCsv(d.action),
          escapeCsv(d.taskId),
          escapeCsv(`${d.fromStatus} -> ${d.resultStatus || d.toStatus || ""}: ${d.comment}`),
          escapeCsv(d.status),
          new Date(d.createdAt * 1000).toISOString(),
        ]);
      }
    }

    const csvContent = rows.map((r) => r.join(",")).join("\n");
    return new NextResponse(csvContent, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="aoc-audit-log-${days}d.csv"`,
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json(
    {
      exportedAt: new Date().toISOString(),
      days,
      auditLogs: logs,
      decisions: decisions.filter((d) => d.createdAt >= sinceSec),
    },
    {
      headers: {
        "Content-Disposition": `attachment; filename="aoc-audit-log-${days}d.json"`,
        "Cache-Control": "no-store",
      },
    }
  );
}

function escapeCsv(val: string): string {
  if (val.includes(",") || val.includes('"') || val.includes("\n") || val.includes("\r")) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}
