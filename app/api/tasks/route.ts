import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/hermes";
import { audit, enqueueMove, listMoves } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  triage: ["todo"],
  todo: ["scheduled"],
  scheduled: ["todo", "ready"],
  ready: ["todo", "running"],
  running: ["blocked", "review"],
  blocked: ["ready"], // CEO-only via decisions, but allow direct DnD from blocked→ready
  review: ["done"],
  done: ["todo"], // reopen
};

export function GET(request: NextRequest) {
  const board = request.nextUrl.searchParams.get("board") || undefined;
  const taskId = request.nextUrl.searchParams.get("taskId") || undefined;
  try { return NextResponse.json({ moves: listMoves(board, taskId) }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "Historia ruchów jest niedostępna" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const expectedOrigin = process.env.AOC_PUBLIC_URL || "https://agents.paterski.com";
  if (request.headers.get("origin") !== expectedOrigin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const raw = JSON.stringify(await request.json());
    if (raw.length > 12_000) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    const value = JSON.parse(raw) as Record<string, unknown>;
    const board = String(value.board || "");
    const title = String(value.title || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ");
    const body = String(value.body || "").trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
    const assignee = String(value.assignee || "").trim() || null;
    const priority = Number(value.priority);

    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(board)) return NextResponse.json({ error: "Nieprawidłowy board" }, { status: 400 });
    if (title.length < 3 || title.length > 160) return NextResponse.json({ error: "Tytuł musi mieć 3–160 znaków" }, { status: 400 });
    if (body.length < 10 || body.length > 6_000) return NextResponse.json({ error: "Opis musi mieć 10–6000 znaków" }, { status: 400 });
    if (![1, 2, 3, 4].includes(priority)) return NextResponse.json({ error: "Priorytet 1-4" }, { status: 400 });

    // Validate board exists
    const snapshot = getSnapshot(board);
    if (snapshot.selectedBoard !== board) return NextResponse.json({ error: "Nieznany board" }, { status: 404 });

    const taskId = `task_${crypto.randomUUID().replaceAll("-", "").slice(0, 12)}`;
    const result = enqueueMove({
      action: "create", board, taskId,
      title, body, assignee: assignee || undefined, priority,
      fromStatus: "triage", toStatus: "triage",
      comment: "Created from AOC panel",
    });
    audit("ceo", "task.create", `${board}/${taskId}`, title, ip(request));
    return NextResponse.json({ id: taskId, status: result.status }, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Nie udało się utworzyć zadania" }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  const expectedOrigin = process.env.AOC_PUBLIC_URL || "https://agents.paterski.com";
  if (request.headers.get("origin") !== expectedOrigin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const raw = JSON.stringify(await request.json());
    if (raw.length > 4_000) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    const value = JSON.parse(raw) as Record<string, unknown>;
    const board = String(value.board || "");
    const taskId = String(value.taskId || "");
    const targetStatus = String(value.targetStatus || "");

    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(board) || !/^[A-Za-z0-9_-]{3,80}$/.test(taskId)) return NextResponse.json({ error: "Nieprawidłowy board lub task" }, { status: 400 });

    const allowedTargets = ALLOWED_TRANSITIONS[targetStatus];
    if (!allowedTargets) return NextResponse.json({ error: `Nieznany status docelowy: ${targetStatus}` }, { status: 400 });

    const snapshot = getSnapshot(board);
    if (snapshot.selectedBoard !== board) return NextResponse.json({ error: "Nieznany board" }, { status: 404 });
    const task = snapshot.tasks.find((t) => t.id === taskId);
    if (!task) return NextResponse.json({ error: "Task nie istnieje" }, { status: 404 });
    if (!allowedTargets.includes(task.status)) return NextResponse.json({ error: `Przejście ${task.status}→${targetStatus} nie jest dozwolone` }, { status: 409 });
    if (task.status === targetStatus) return NextResponse.json({ error: "Task już ma ten status" }, { status: 409 });

    // blocked→ready requires CEO decision flow, redirect
    if (task.status === "blocked" && targetStatus === "ready") {
      return NextResponse.json({ error: "Użyj akcji 'Akceptuj i odblokuj' w panelu decyzji CEO" }, { status: 409 });
    }

    const result = enqueueMove({
      action: "move", board, taskId,
      fromStatus: task.status, toStatus: targetStatus,
      comment: `CEO drag: ${task.status}→${targetStatus}`,
    });
    audit("ceo", "task.move", `${board}/${taskId}`, `${task.status}→${targetStatus}`, ip(request));
    return NextResponse.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) return NextResponse.json({ error: "Ta karta ma już oczekujący ruch" }, { status: 409 });
    return NextResponse.json({ error: "Nie udało się przenieść zadania" }, { status: 500 });
  }
}
