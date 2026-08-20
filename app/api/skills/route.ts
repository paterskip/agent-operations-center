import { NextRequest, NextResponse } from "next/server";
import {
  getSkillCatalogSummary,
  getSkillBySlug,
  getSkillsForAgent,
  validateSkillTier1,
  validateSkillTier2,
} from "@/lib/skills-registry";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const slug = searchParams.get("slug");
    const agent = searchParams.get("agent");

    if (slug) {
      const skill = getSkillBySlug(slug);
      if (!skill) {
        return NextResponse.json({ error: "Skill nie został odnaleziony" }, { status: 404 });
      }
      const tier1 = validateSkillTier1(slug);
      const tier2 = validateSkillTier2(slug);
      return NextResponse.json(
        { skill, tier1, tier2 },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    if (agent) {
      const skills = getSkillsForAgent(agent);
      return NextResponse.json(
        { skills },
        { headers: { "Cache-Control": "no-store" } }
      );
    }

    const summary = getSkillCatalogSummary();
    return NextResponse.json(summary, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ error: "Błąd odczytu rejestru skilli" }, { status: 500 });
  }
}
