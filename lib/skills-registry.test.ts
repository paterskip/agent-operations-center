import { describe, it, expect } from "vitest";
import {
  discoverSkills,
  getSkillBySlug,
  getSkillsForAgent,
  getSkillCatalogSummary,
  validateSkillTier1,
  validateSkillTier2,
} from "./skills-registry";

describe("Skills Registry", () => {
  it("discovers all verified skills in skills directory", () => {
    const skills = discoverSkills();
    expect(skills.length).toBeGreaterThanOrEqual(4);

    const slugs = skills.map((s) => s.slug);
    expect(slugs).toContain("pm-task-decomposition");
    expect(slugs).toContain("anti-slop-code-review");
    expect(slugs).toContain("sec-ops-vulnerability-scan");
    expect(slugs).toContain("qa-regression-testing");
  });

  it("parses frontmatter and attaches benchmark metrics accurately", () => {
    const skill = getSkillBySlug("anti-slop-code-review");
    expect(skill).not.toBeNull();
    expect(skill?.name).toBe("anti-slop-code-review");
    expect(skill?.isVerified).toBe(true);
    expect(skill?.assignedAgents).toContain("reviewer");
    expect(skill?.overallLift).toBeGreaterThan(40);
    expect(skill?.testCases.length).toBeGreaterThanOrEqual(2);
  });

  it("filters skills by assigned agent slug", () => {
    const pmSkills = getSkillsForAgent("pm");
    expect(pmSkills.some((s) => s.slug === "pm-task-decomposition")).toBe(true);

    const secSkills = getSkillsForAgent("security");
    expect(secSkills.some((s) => s.slug === "sec-ops-vulnerability-scan")).toBe(true);
  });

  it("computes catalog summary metrics (avg lift, verified count)", () => {
    const summary = getSkillCatalogSummary();
    expect(summary.totalSkills).toBeGreaterThanOrEqual(4);
    expect(summary.verifiedSkills).toBeGreaterThanOrEqual(4);
    expect(summary.avgSkillLift).toBeGreaterThan(30);
    expect(summary.avgTokenSavings).toBeGreaterThan(20);
  });

  it("runs Tier 1 validation and passes verified skills without security violations", () => {
    const result = validateSkillTier1("sec-ops-vulnerability-scan");
    expect(result.isValid).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
    expect(result.securityChecks.noHardcodedSecrets).toBe(true);
    expect(result.securityChecks.noDangerousPatterns).toBe(true);
  });

  it("runs Tier 2 validation and computes distinctiveness score", () => {
    const result = validateSkillTier2("pm-task-decomposition");
    expect(result.distinctivenessScore).toBeGreaterThanOrEqual(75);
  });
});
