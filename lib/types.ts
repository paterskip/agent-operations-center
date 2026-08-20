export const STATUSES = ["triage", "todo", "scheduled", "ready", "running", "blocked", "review", "done"] as const;
export type TaskStatus = (typeof STATUSES)[number] | "archived" | string;

export interface BoardSummary {
  slug: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  counts: Record<string, number>;
  lastActivityAt: number | null;
}

export interface AgentSummary {
  slug: string;
  name: string;
  description: string;
  status: "working" | "blocked" | "idle";
  currentTask: string | null;
  currentBoard: string | null;
  completed: number;
  blocked: number;
  lastHeartbeatAt: number | null;
}

export interface TaskCard {
  id: string;
  title: string;
  body: string;
  assignee: string | null;
  status: TaskStatus;
  priority: number;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  branchName: string | null;
  result: string | null;
  blockKind: string | null;
  lastHeartbeatAt: number | null;
  modelOverride: string | null;
  boardSlug: string;
  parentIds: string[];
  childIds: string[];
  comments: Array<{ id: number; author: string; body: string; createdAt: number }>;
  runs: Array<{ id: number; profile: string; status: string; outcome: string | null; startedAt: number | null; endedAt: number | null; summary: string | null; error: string | null }>;
  attachmentCount: number;
}

export interface ActivityEvent {
  id: number;
  taskId: string;
  kind: string;
  payload: Record<string, unknown> | string | null;
  createdAt: number;
  board: string;
  taskTitle: string;
  assignee: string | null;
}

export interface DashboardSnapshot {
  generatedAt: number;
  selectedBoard: string;
  boards: BoardSummary[];
  agents: AgentSummary[];
  tasks: TaskCard[];
  activity: ActivityEvent[];
}

export interface IdeaRecord {
  id: string;
  title: string;
  description: string;
  project: string;
  priority: number;
  mode: "draft" | "analysis";
  status: string;
  hermesTaskId: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface DecisionRecord {
  id: string;
  board: string;
  taskId: string;
  action: "approve" | "reject" | "resume" | "hold";
  fromStatus: string;
  toStatus: string | null;
  comment: string;
  status: string;
  resultStatus: string | null;
  lastError: string | null;
  createdAt: number;
  updatedAt: number;
}

export type SkillDimension = "correctness" | "discoverability" | "effectiveness" | "efficiency" | "security";

export interface SkillBenchmarkDimensionScore {
  dimension: SkillDimension;
  baselineScore: number;
  withSkillScore: number;
  skillLift: number;
}

export interface SkillBenchmarkRecord {
  skillSlug: string;
  harness: string;
  evaluatedAt: number;
  attempts: number;
  scores: SkillBenchmarkDimensionScore[];
  tokenUsage: {
    baselineAvg: number;
    withSkillAvg: number;
    tokenDeltaPercent: number;
  };
  stepCount: {
    baselineAvg: number;
    withSkillAvg: number;
    stepSavingsPercent: number;
  };
  verificationStatus: "verified" | "unverified" | "needs_eval" | "failing";
  securityGatePassed: boolean;
}

export interface SkillTestCase {
  id: string;
  kind: "explicit" | "implicit" | "contextual" | "negative";
  prompt: string;
  expectedOutcome: string;
}

export interface SkillRecord {
  slug: string;
  name: string;
  version: string;
  description: string;
  author: string;
  triggers: string[];
  assignedAgents: string[];
  isVerified: boolean;
  content: string;
  testCases: SkillTestCase[];
  benchmarks: SkillBenchmarkRecord[];
  overallLift: number;
}

export interface SkillCatalogSummary {
  totalSkills: number;
  verifiedSkills: number;
  avgSkillLift: number;
  avgTokenSavings: number;
  skills: SkillRecord[];
}
