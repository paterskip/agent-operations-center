import { NextRequest, NextResponse } from "next/server";
import { findTask } from "@/lib/hermes";
import { audit, enqueueDecision, listDecisions } from "@/lib/state";
import { decisionAllowed, decisionTransitions } from "@/lib/decision-policy";
import { DecisionCreateSchema } from "@/lib/schemas";
import { CSRF_REJECTED, isSameOriginRequest } from "@/lib/csrf";

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
  if (!isSameOriginRequest(request)) return NextResponse.json(CSRF_REJECTED, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const raw: unknown = await request.json();
    const parseResult = DecisionCreateSchema.safeParse(raw);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Nieprawidłowe dane decyzji";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { board, taskId, action, comment } = parseResult.data;

    if (["reject", "hold"].includes(action) && comment.length < 5) {
      return NextResponse.json({ error: "Podaj powód (minimum 5 znaków)" }, { status: 400 });
    }

    // findTask resolves the task on the requested board first and falls back to
    // the remaining boards, reading each board's tasks once. The previous
    // getSnapshot() per board rebuilt a full cross-board snapshot for every
    // candidate board, so one decision cost O(boards²) reads.
    const found = findTask(taskId, board);
    if (!found) return NextResponse.json({ error: "Task nie istnieje" }, { status: 404 });
    const { task, board: actualBoard } = found;

    if (!decisionAllowed(action, task.status)) return NextResponse.json({ error: `Akcja ${action} nie jest dozwolona dla statusu ${task.status}` }, { status: 409 });

    const rule = decisionTransitions[action];
    const result = enqueueDecision({ board: actualBoard, taskId, action, fromStatus: task.status, toStatus: rule.expected, comment });

    audit("ceo", `task.${action}`, `${board}/${taskId}`, `${task.status}->${rule.expected || "auto"}`, ip(request));
    return NextResponse.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return NextResponse.json({ error: "Ta karta ma już oczekującą decyzję" }, { status: 409 });
    return NextResponse.json({ error: "Nie udało się zapisać decyzji" }, { status: 500 });
  }
}
