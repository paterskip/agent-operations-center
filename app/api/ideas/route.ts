import { NextRequest, NextResponse } from "next/server";
import { createIdea, listIdeas, audit } from "@/lib/state";
import { discoverBoards } from "@/lib/hermes";
import { IdeaCreateSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function GET() {
  try { return NextResponse.json({ ideas: listIdeas() }, { headers: { "Cache-Control": "no-store" } }); }
  catch { return NextResponse.json({ error: "CEO Inbox is unavailable" }, { status: 500 }); }
}

export async function POST(request: NextRequest) {
  const expectedOrigin = process.env.AOC_PUBLIC_URL || "https://agents.paterski.com";
  if (request.headers.get("origin") !== expectedOrigin) return NextResponse.json({ error: "Invalid request origin" }, { status: 403 });
  if (!request.headers.get("content-type")?.startsWith("application/json")) return NextResponse.json({ error: "JSON required" }, { status: 415 });
  try {
    const text = await request.text();
    if (text.length > 12_000) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    const raw: unknown = JSON.parse(text);
    const parseResult = IdeaCreateSchema.safeParse(raw);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Nieprawidłowe dane pomysłu";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { title, description, project, priority, mode } = parseResult.data;
    const projects = new Set(discoverBoards().map((board) => board.slug).filter((slug) => slug !== "default"));
    if (!projects.has(project)) return NextResponse.json({ error: "Nieznany projekt docelowy" }, { status: 400 });

    const idea = createIdea({ title, description, project, priority, mode });
    audit("ceo", mode === "draft" ? "idea.draft" : "idea.submit", idea.id, project, clientIp(request));
    return NextResponse.json(idea, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Nie udało się zapisać pomysłu" }, { status: 500 });
  }
}
