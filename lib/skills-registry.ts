import fs from "node:fs";
import path from "node:path";
import { SkillBenchmarkSchema, SkillFrontmatterSchema, SkillTestCaseSchema } from "./schemas";
import type { SkillBenchmarkRecord, SkillCatalogSummary, SkillRecord, SkillTestCase } from "./types";

const defaultSkillsRoot = path.join(process.cwd(), "skills");

function parseFrontmatter(markdown: string): { frontmatter: Record<string, unknown>; content: string } {
  const match = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    return { frontmatter: {}, content: markdown };
  }

  const rawYaml = match[1] ?? "";
  const content = match[2] ?? "";
  const lines = rawYaml.split("\n");
  const result: Record<string, unknown> = {};

  let currentKey: string | null = null;
  let currentList: string[] | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    if (trimmed.startsWith("- ") && currentKey && currentList) {
      const val = trimmed.slice(2).trim().replace(/^["']|["']$/g, "");
      currentList.push(val);
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    if (colonIdx !== -1) {
      if (currentKey && currentList) {
        result[currentKey] = currentList;
        currentKey = null;
        currentList = null;
      }

      const key = trimmed.slice(0, colonIdx).trim();
      const valPart = trimmed.slice(colonIdx + 1).trim();

      if (valPart === "") {
        currentKey = key;
        currentList = [];
      } else {
        const val = valPart.replace(/^["']|["']$/g, "");
        result[key] = val;
      }
    }
  }

  if (currentKey && currentList) {
    result[currentKey] = currentList;
  }

  return { frontmatter: result, content };
}

export function readBenchmarks(benchmarksPath?: string): Map<string, SkillBenchmarkRecord[]> {
  const file = benchmarksPath ?? path.join(defaultSkillsRoot, "benchmarks.json");
  const map = new Map<string, SkillBenchmarkRecord[]>();

  if (!fs.existsSync(/*turbopackIgnore: true*/ file)) {
    return map;
  }

  try {
    const raw = fs.readFileSync(/*turbopackIgnore: true*/ file, "utf8");
    const parsedJson: unknown = JSON.parse(raw);
    if (!Array.isArray(parsedJson)) {
      return map;
    }

    for (const item of parsedJson) {
      const parsed = SkillBenchmarkSchema.safeParse(item);
      if (parsed.success) {
        const list = map.get(parsed.data.skillSlug) ?? [];
        list.push(parsed.data);
        map.set(parsed.data.skillSlug, list);
      }
    }
  } catch {
    return map;
  }

  return map;
}

export function discoverSkills(skillsDirectory?: string): SkillRecord[] {
  const dir = skillsDirectory ?? defaultSkillsRoot;
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    return [];
  }

  const benchmarksMap = readBenchmarks(path.join(dir, "benchmarks.json"));
  const records: SkillRecord[] = [];

  const entries = fs.readdirSync(/*turbopackIgnore: true*/ dir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    const skillSlug = entry.name;
    const skillPath = path.join(dir, skillSlug);
    const skillMdFile = path.join(skillPath, "SKILL.md");

    if (!fs.existsSync(/*turbopackIgnore: true*/ skillMdFile)) {
      continue;
    }

    let markdown = "";
    try {
      markdown = fs.readFileSync(/*turbopackIgnore: true*/ skillMdFile, "utf8");
    } catch {
      continue;
    }

    const { frontmatter, content } = parseFrontmatter(markdown);
    const validatedFm = SkillFrontmatterSchema.safeParse(frontmatter);

    const testCases: SkillTestCase[] = [];
    const evalsFile = path.join(skillPath, "evals", "evals.json");
    if (fs.existsSync(evalsFile)) {
      try {
        const evalsRaw = fs.readFileSync(evalsFile, "utf8");
        const evalsParsed: unknown = JSON.parse(evalsRaw);
        if (Array.isArray(evalsParsed)) {
          for (const tc of evalsParsed) {
            const tcParsed = SkillTestCaseSchema.safeParse(tc);
            if (tcParsed.success) {
              testCases.push(tcParsed.data);
            }
          }
        }
      } catch {
        // Skip unreadable evals.json
      }
    }

    const benchmarks = benchmarksMap.get(skillSlug) ?? [];
    let overallLift = 0;
    if (benchmarks.length > 0) {
      const totalScoreSum = benchmarks.reduce((acc, b) => {
        const liftSum = b.scores.reduce((sAcc, s) => sAcc + s.skillLift, 0);
        return acc + (b.scores.length > 0 ? liftSum / b.scores.length : 0);
      }, 0);
      overallLift = Math.round((totalScoreSum / benchmarks.length) * 10) / 10;
    }

    const isVerified = benchmarks.some((b) => b.verificationStatus === "verified" && b.securityGatePassed);

    const name = validatedFm.success ? validatedFm.data.name : skillSlug;
    const version = validatedFm.success ? validatedFm.data.version : "1.0.0";
    const description = validatedFm.success ? validatedFm.data.description : "";
    const author = validatedFm.success ? validatedFm.data.author : "AOC Team";
    const triggers = validatedFm.success ? validatedFm.data.triggers : [];
    const assignedAgents = validatedFm.success ? validatedFm.data.assignedAgents : [];

    records.push({
      slug: skillSlug,
      name,
      version,
      description,
      author,
      triggers,
      assignedAgents,
      isVerified,
      content,
      testCases,
      benchmarks,
      overallLift,
    });
  }

  return records.sort((a, b) => b.overallLift - a.overallLift);
}

export function getSkillCatalogSummary(skillsDirectory?: string): SkillCatalogSummary {
  const skills = discoverSkills(skillsDirectory);
  const totalSkills = skills.length;
  const verifiedSkills = skills.filter((s) => s.isVerified).length;

  let totalLiftSum = 0;
  let liftCount = 0;
  let totalTokenDeltaSum = 0;
  let tokenCount = 0;

  for (const s of skills) {
    if (s.benchmarks.length > 0) {
      totalLiftSum += s.overallLift;
      liftCount++;
      for (const b of s.benchmarks) {
        totalTokenDeltaSum += Math.abs(b.tokenUsage.tokenDeltaPercent);
        tokenCount++;
      }
    }
  }

  const avgSkillLift = liftCount > 0 ? Math.round((totalLiftSum / liftCount) * 10) / 10 : 0;
  const avgTokenSavings = tokenCount > 0 ? Math.round((totalTokenDeltaSum / tokenCount) * 10) / 10 : 0;

  return {
    totalSkills,
    verifiedSkills,
    avgSkillLift,
    avgTokenSavings,
    skills,
  };
}

export function getSkillBySlug(slug: string, skillsDirectory?: string): SkillRecord | null {
  const skills = discoverSkills(skillsDirectory);
  return skills.find((s) => s.slug === slug) ?? null;
}

export function getSkillsForAgent(agentSlug: string, skillsDirectory?: string): SkillRecord[] {
  const skills = discoverSkills(skillsDirectory);
  return skills.filter((s) => s.assignedAgents.includes(agentSlug) || s.assignedAgents.includes("*"));
}

export interface Tier1ValidationResult {
  isValid: boolean;
  score: number;
  issues: string[];
  securityChecks: {
    noHardcodedSecrets: boolean;
    noDangerousPatterns: boolean;
    hasFrontmatter: boolean;
    hasTriggers: boolean;
    hasDefinitionOfDone: boolean;
  };
}

export function validateSkillTier1(skillSlug: string, skillsDirectory?: string): Tier1ValidationResult {
  const skill = getSkillBySlug(skillSlug, skillsDirectory);
  const issues: string[] = [];

  if (!skill) {
    return {
      isValid: false,
      score: 0,
      issues: [`Skill '${skillSlug}' nie został odnaleziony w katalogu.`],
      securityChecks: {
        noHardcodedSecrets: false,
        noDangerousPatterns: false,
        hasFrontmatter: false,
        hasTriggers: false,
        hasDefinitionOfDone: false,
      },
    };
  }

  const fullText = `${skill.description}\n${skill.content}`;
  
  // Security Checks
  const secretPattern = /(?:sk-[A-Za-z0-9]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})/i;
  const noHardcodedSecrets = !secretPattern.test(fullText);
  if (!noHardcodedSecrets) {
    issues.push("Wykryto potencjalny hardcoded klucz API lub token autoryzacyjny.");
  }

  const dangerousPattern = /(?:rm\s+-rf\s+\/|eval\s*\(|chmod\s+777|DROP\s+DATABASE)/i;
  const noDangerousPatterns = !dangerousPattern.test(fullText);
  if (!noDangerousPatterns) {
    issues.push("Wykryto niebezpieczną instrukcję powłoki lub bazy danych.");
  }

  const hasFrontmatter = skill.name.length > 0 && skill.description.length > 0;
  if (!hasFrontmatter) {
    issues.push("Brak wymaganych metadanych frontmatter (name, description).");
  }

  const hasTriggers = skill.triggers.length > 0;
  if (!hasTriggers) {
    issues.push("Brak zdefiniowanych triggerów aktywacji skilla.");
  }

  const hasDefinitionOfDone = /Kryteria Akceptacji|Definition of Done|Weryfikacja/i.test(skill.content);
  if (!hasDefinitionOfDone) {
    issues.push("Zalecane dodanie sekcji 'Kryteria Akceptacji' lub 'Definition of Done'.");
  }

  let passedCheckCount = 0;
  if (noHardcodedSecrets) passedCheckCount++;
  if (noDangerousPatterns) passedCheckCount++;
  if (hasFrontmatter) passedCheckCount++;
  if (hasTriggers) passedCheckCount++;
  if (hasDefinitionOfDone) passedCheckCount++;

  const score = Math.round((passedCheckCount / 5) * 100);
  const isValid = noHardcodedSecrets && noDangerousPatterns && hasFrontmatter && hasTriggers;

  return {
    isValid,
    score,
    issues,
    securityChecks: {
      noHardcodedSecrets,
      noDangerousPatterns,
      hasFrontmatter,
      hasTriggers,
      hasDefinitionOfDone,
    },
  };
}

export interface Tier2ValidationResult {
  distinctivenessScore: number;
  hasConflicts: boolean;
  overlappingSkills: Array<{ slug: string; sharedTriggers: string[] }>;
}

export function validateSkillTier2(skillSlug: string, skillsDirectory?: string): Tier2ValidationResult {
  const catalog = discoverSkills(skillsDirectory);
  const target = catalog.find((s) => s.slug === skillSlug);

  if (!target) {
    return {
      distinctivenessScore: 0,
      hasConflicts: false,
      overlappingSkills: [],
    };
  }

  const targetTriggers = new Set(target.triggers.map((t) => t.toLowerCase().trim()));
  const overlapping: Array<{ slug: string; sharedTriggers: string[] }> = [];

  for (const other of catalog) {
    if (other.slug === target.slug) continue;
    const shared: string[] = [];
    for (const ot of other.triggers) {
      if (targetTriggers.has(ot.toLowerCase().trim())) {
        shared.push(ot);
      }
    }
    if (shared.length > 0) {
      overlapping.push({ slug: other.slug, sharedTriggers: shared });
    }
  }

  const hasConflicts = overlapping.length > 0;
  const distinctivenessScore = Math.max(0, 100 - overlapping.length * 25);

  return {
    distinctivenessScore,
    hasConflicts,
    overlappingSkills: overlapping,
  };
}
