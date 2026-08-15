import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/hermes";
import { audit, enqueueMove } from "@/lib/state";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function ip(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export async function POST(request: NextRequest) {
  const expectedOrigin = process.env.AOC_PUBLIC_URL || "https://agents.paterski.com";
  if (request.headers.get("origin") !== expectedOrigin) {
    return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  }
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    return NextResponse.json({ error: "JSON required" }, { status: 415 });
  }

  try {
    const raw = JSON.stringify(await request.json());
    if (raw.length > 4_000) {
      return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    }
    const value = JSON.parse(raw) as Record<string, unknown>;
    const board = String(value.board || "");
    const taskId = String(value.taskId || "");
    const comment = String(value.comment || "").trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");

    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(board) || !/^[A-Za-z0-9_-]{3,80}$/.test(taskId)) {
      return NextResponse.json({ error: "Nieprawidłowy board lub task" }, { status: 400 });
    }
    if (comment.length < 2) {
      return NextResponse.json({ error: "Komentarz musi zawierać co najmniej 2 znaki" }, { status: 400 });
    }
    if (comment.length > 2_000) {
      return NextResponse.json({ error: "Komentarz nie może przekraczać 2000 znaków" }, { status: 400 });
    }

    const snapshot = getSnapshot(board);
    if (snapshot.selectedBoard !== board) {
      return NextResponse.json({ error: "Nieznany board" }, { status: 404 });
    }
    const task = snapshot.tasks.find((t) => t.id === taskId);
    if (!task) {
      return NextResponse.json({ error: "Task nie istnieje" }, { status: 404 });
    }

    const result = enqueueMove({
      action: "comment",
      board,
      taskId,
      comment,
    });

    audit("ceo", "task.comment", `${board}/${taskId}`, comment.slice(0, 60), ip(request));

    return NextResponse.json(result, { status: 202, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Nie udało się zapisać komentarza";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
