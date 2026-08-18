import { NextRequest, NextResponse } from "next/server";
import { discoverBoards } from "@/lib/hermes";
import { enqueueProjectCreate, audit } from "@/lib/state";
import { ProjectCreateSchema } from "@/lib/schemas";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RESERVED_SLUGS = new Set(["default", "overview", "all", "security", "settings", "audit", "inbox", "agents"]);

function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

export function GET() {
  try {
    const boards = discoverBoards();
    return NextResponse.json({ projects: boards }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Nie udało się pobrać listy projektów" }, { status: 500 });
  }
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
    const text = await request.text();
    if (text.length > 4096) {
      return NextResponse.json({ error: "Request is too large" }, { status: 413 });
    }
    const raw: unknown = JSON.parse(text);
    const parseResult = ProjectCreateSchema.safeParse(raw);
    if (!parseResult.success) {
      const firstError = parseResult.error.issues[0]?.message || "Nieprawidłowe dane projektu";
      return NextResponse.json({ error: firstError }, { status: 400 });
    }

    const { name, slug, description, icon, color, defaultWorkdir } = parseResult.data;

    if (RESERVED_SLUGS.has(slug)) {
      return NextResponse.json({ error: `Identyfikator '${slug}' jest zastrzeżony` }, { status: 400 });
    }

    const existing = discoverBoards();
    if (existing.some((b) => b.slug.toLowerCase() === slug.toLowerCase())) {
      return NextResponse.json({ error: `Projekt o identyfikatorze '${slug}' już istnieje` }, { status: 409 });
    }

    const result = enqueueProjectCreate({
      slug,
      name,
      description,
      icon,
      color,
      defaultWorkdir,
    });

    audit("ceo", "project.create", slug, `name=${name}`, clientIp(request));

    return NextResponse.json(
      { ok: true, slug, status: result.status },
      { status: 201, headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ error: "Nie udało się utworzyć projektu" }, { status: 500 });
  }
}
