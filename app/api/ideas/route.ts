import { NextRequest, NextResponse } from "next/server";
import { createIdea, listIdeas, audit } from "@/lib/state";
import { discoverBoards } from "@/lib/hermes";

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
    const raw = JSON.stringify(await request.json());
    if (raw.length > 12_000) return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    const value = JSON.parse(raw) as Record<string, unknown>;
    const title = String(value.title || "").trim().replace(/[\u0000-\u001f\u007f]/g, " ");
    const description = String(value.description || "").trim().replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
    const project = String(value.project || "");
    const priority = Number(value.priority);
    const mode = value.mode === "draft" ? "draft" : value.mode === "analysis" ? "analysis" : null;
    const projects = new Set(discoverBoards().map((board) => board.slug).filter((slug) => slug !== "default" && slug !== "portfolio"));
    if (title.length < 3 || title.length > 160) return NextResponse.json({ error: "Tytuł musi mieć 3–160 znaków" }, { status: 400 });
    if (description.length < 10 || description.length > 6_000) return NextResponse.json({ error: "Opis musi mieć 10–6000 znaków" }, { status: 400 });
    if (!projects.has(project)) return NextResponse.json({ error: "Nieznany projekt docelowy" }, { status: 400 });
    if (![1, 2, 3, 4].includes(priority) || !mode) return NextResponse.json({ error: "Nieprawidłowy priorytet lub tryb" }, { status: 400 });
    const idea = createIdea({ title, description, project, priority, mode });
    audit("ceo", mode === "draft" ? "idea.draft" : "idea.submit", idea.id, project, clientIp(request));
    return NextResponse.json(idea, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Nie udało się zapisać pomysłu" }, { status: 500 });
  }
}
