import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { GET } from "./route";

describe("GET /api/skills", () => {
  it("returns skills catalog summary with no-store cache header", async () => {
    const req = new NextRequest("http://localhost:3010/api/skills");
    const res = await GET(req);

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");

    const data = await res.json();
    expect(data.totalSkills).toBeGreaterThanOrEqual(4);
    expect(data.verifiedSkills).toBeGreaterThanOrEqual(4);
    expect(data.avgSkillLift).toBeGreaterThan(30);
    expect(Array.isArray(data.skills)).toBe(true);
  });

  it("returns skill details and Tier 1 / Tier 2 validation when ?slug=... is provided", async () => {
    const req = new NextRequest("http://localhost:3010/api/skills?slug=anti-slop-code-review");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.skill).toBeDefined();
    expect(data.skill.slug).toBe("anti-slop-code-review");
    expect(data.tier1).toBeDefined();
    expect(data.tier1.isValid).toBe(true);
    expect(data.tier2).toBeDefined();
    expect(data.tier2.distinctivenessScore).toBeGreaterThan(50);
  });

  it("returns 404 when requested skill slug does not exist", async () => {
    const req = new NextRequest("http://localhost:3010/api/skills?slug=non-existent-skill");
    const res = await GET(req);

    expect(res.status).toBe(404);
    const data = await res.json();
    expect(data.error).toContain("nie został odnaleziony");
  });

  it("returns skills filtered by agent when ?agent=... is provided", async () => {
    const req = new NextRequest("http://localhost:3010/api/skills?agent=pm");
    const res = await GET(req);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(Array.isArray(data.skills)).toBe(true);
    expect(data.skills.some((s: { slug: string }) => s.slug === "pm-task-decomposition")).toBe(true);
  });
});
