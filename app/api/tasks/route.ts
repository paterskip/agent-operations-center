import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/hermes";
import { audit, enqueueMove, listMoves } from "@/lib/state";
import { isAllowedMove, ALLOWED_DROPS } from "@/lib/transitions";
import { TaskCreateSchema, TaskPatchSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

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
    const text = await request.text();
    if (text.length > 12_000) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    const raw: unknown = JSON.parse(text);
    const parseResult = TaskCreateSchema.safeParse(raw);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Nieprawidłowe dane zadania";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { board, title, body, assignee, priority } = parseResult.data;

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
    const raw: unknown = await request.json();
    const parseResult = TaskPatchSchema.safeParse(raw);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Nieprawidłowe dane";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { board, taskId, targetStatus } = parseResult.data;
    if (!(targetStatus in ALLOWED_DROPS)) return NextResponse.json({ error: `Nieznany status docelowy: ${targetStatus}` }, { status: 400 });

    const snapshot = getSnapshot(board);
    if (snapshot.selectedBoard !== board) return NextResponse.json({ error: "Nieznany board" }, { status: 404 });
    const task = snapshot.tasks.find((t) => t.id === taskId);
    if (!task) return NextResponse.json({ error: "Task nie istnieje" }, { status: 404 });
    if (task.status === targetStatus) return NextResponse.json({ error: "Task już ma ten status" }, { status: 409 });
    if (!isAllowedMove(task.status, targetStatus)) {
      if (task.status === "blocked") return NextResponse.json({ error: "Użyj akcji decyzji CEO (Akceptuj / Odrzuć / Wznów), aby odblokować kartę" }, { status: 409 });
      return NextResponse.json({ error: `Przejście ${task.status}→${targetStatus} nie jest dozwolone` }, { status: 409 });
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
