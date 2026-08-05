import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/hermes";
import { audit, enqueueDecision, listDecisions, type DecisionAction } from "@/lib/state";
import { decisionAllowed, decisionTransitions } from "@/lib/decision-policy";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function GET(request: NextRequest) {
  const board = request.nextUrl.searchParams.get("board") || undefined;
  const taskId = request.nextUrl.searchParams.get("taskId") || undefined;
  try { return NextResponse.json({ decisions: listDecisions(board, taskId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Historia decyzji jest niedostępna" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const expectedOrigin = process.env.AOC_PUBLIC_URL || "https://agents.paterski.com";
  if (request.headers.get("origin") !== expectedOrigin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const raw = JSON.stringify(await request.json());
    if (raw.length > 4_000) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    const value = JSON.parse(raw) as Record<string, unknown>;
    const board = String(value.board || "");
    const taskId = String(value.taskId || "");
    const action = String(value.action || "") as DecisionAction;
    const comment = String(value.comment || "").trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(board) || !/^[A-Za-z0-9_-]{3,80}$/.test(taskId)) return NextResponse.json({ error: "Nieprawidłowy board lub task" }, { status: 400 });
    if (!(action in decisionTransitions)) return NextResponse.json({ error: "Niedozwolona akcja" }, { status: 400 });
    if (comment.length > 2_000) return NextResponse.json({ error: "Komentarz jest za długi" }, { status: 400 });
    if (["reject", "hold"].includes(action) && comment.length < 5) return NextResponse.json({ error: "Podaj powód (minimum 5 znaków)" }, { status: 400 });
    const snapshot = getSnapshot(board);
    if (snapshot.selectedBoard !== board) return NextResponse.json({ error: "Nieznany board" }, { status: 404 });
    const task = snapshot.tasks.find((item) => item.id === taskId);
    if (!task) return NextResponse.json({ error: "Task nie istnieje" }, { status: 404 });
    if (!decisionAllowed(action, task.status)) return NextResponse.json({ error: `Akcja ${action} nie jest dozwolona dla statusu ${task.status}` }, { status: 409 });
    const rule = decisionTransitions[action];
    const result = enqueueDecision({ board, taskId, action, fromStatus: task.status, toStatus: rule.expected, comment });
    audit("ceo", `task.${action}`, `${board}/${taskId}`, `${task.status}->${rule.expected || "auto"}`, ip(request));
    return NextResponse.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return NextResponse.json({ error: "Ta karta ma już oczekującą decyzję" }, { status: 409 });
    return NextResponse.json({ error: "Nie udało się zapisać decyzji" }, { status: 500 });
  }
}
