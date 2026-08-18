import { NextRequest, NextResponse } from "next/server";
import { getSnapshot } from "@/lib/hermes";
import { audit, enqueueMove } from "@/lib/state";
import { CommentCreateSchema } from "@/lib/schemas";

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
    const raw: unknown = await request.json();
    const parseResult = CommentCreateSchema.safeParse(raw);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Nieprawidłowe dane komentarza";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { board, taskId, comment } = parseResult.data;

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
    if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
      return NextResponse.json({ error: "Ta karta ma już oczekujący komentarz lub ruch" }, { status: 409 });
    }
    return NextResponse.json({ error: "Nie udało się zapisać komentarza" }, { status: 500 });
  }
}
