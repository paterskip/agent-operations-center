import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/hermes";
import { audit, enqueueDecision, listDecisions } from "@/lib/state";
import { decisionAllowed, decisionTransitions } from "@/lib/decision-policy";
import { DecisionCreateSchema } from "@/lib/schemas";

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

    const snapshot = getSnapshot(board);
    let task = snapshot.selectedBoard === board ? snapshot.tasks.find((item) => item.id === taskId) : null;
    let actualBoard = board;


    if (!task) {
      // Fallback: search for task across all boards to handle cross-board decisions securely
      const allBoards = snapshot.boards;
      for (const b of allBoards) {
        if (b.slug === board) continue;
        const bs = getSnapshot(b.slug);
        const found = bs.tasks.find((item) => item.id === taskId);
        if (found) {
          task = found;
          actualBoard = b.slug;
          break;
        }
      }
    }

    if (!task) return NextResponse.json({ error: "Task nie istnieje" }, { status: 404 });
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
