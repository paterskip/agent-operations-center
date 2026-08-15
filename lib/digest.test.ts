import { describe, expect, it } from "vitest";
import { generateDailyDigest } from "./digest";
import type { DashboardSnapshot } from "./types";
import type { AgentScorecardRow } from "./scorecard";

const mockSnapshot: DashboardSnapshot = {
  generatedAt: 1700000000000,
  selectedBoard: "app-one",
  boards: [
    {
      slug: "app-one",
      name: "App One",
      description: "",
      icon: "⚽",
      color: "#0",
      counts: { running: 1, blocked: 1, done: 5 },
      lastActivityAt: null,
    },
  ],
  agents: [
    {
      slug: "coder",
      name: "Software Engineer",
      description: "Dev",
      status: "working",
      currentTask: "Implement auth",
      currentBoard: "app-one",
      completed: 5,
      blocked: 1,
      lastHeartbeatAt: null,
    },
  ],
  tasks: [
    {
      id: "T-1",
      boardSlug: "app-one",
      title: "Implement auth",
      body: "OAuth flow",
      assignee: "coder",
      status: "running",
      priority: 2,
      createdAt: 1700000000,
      startedAt: 1700000000,
      completedAt: null,
      branchName: "feat/auth",
      result: null,
      blockKind: null,
      lastHeartbeatAt: 1700000000,
      modelOverride: null,
      attachmentCount: 0,
      parentIds: [],
      childIds: [],
      comments: [],
      runs: [],
    },
    {
      id: "T-2",
      boardSlug: "app-one",
      title: "Fix crash on boot",
      body: "Needs key",
      assignee: "coder",
      status: "blocked",
      priority: 4,
      createdAt: 1699900000,
      startedAt: 1699900000,
      completedAt: null,
      branchName: null,
      result: null,
      blockKind: "needs_input",
      lastHeartbeatAt: null,
      modelOverride: null,
      attachmentCount: 0,
      parentIds: [],
      childIds: [],
      comments: [{ id: 1, author: "coder", body: "Missing API key in secret store", createdAt: 1699910000 }],
      runs: [],
    },
  ],
  activity: [],
};

const mockScorecard: AgentScorecardRow[] = [
  {
    slug: "coder",
    name: "Software Engineer",
    done7: 4,
    done30: 12,
    blocked7: 1,
    blocked30: 2,
    created30: 0,
    rework30: 1,
    running: 1,
    total: 15,
    sessions30: 10,
    tokens30: 1500000,
    cost30: 4.5,
  },
];

describe("generateDailyDigest", () => {
  it("generates markdown report with metrics and attention list", () => {
    const md = generateDailyDigest(mockSnapshot, mockScorecard, 1700010000000);
    expect(md).toContain("# 🛰️ Agent Operations Center — Raport Dzienny");
    expect(md).toContain("Wymagające uwagi CEO (1)");
    expect(md).toContain("`T-2` [BLOCKED]");
    expect(md).toContain("Missing API key in secret store");
    expect(md).toContain("Aktualnie w realizacji (1)");
    expect(md).toContain("`T-1`");
    expect(md).toContain("Efektywność Agentów (30 dni)");
    expect(md).toContain("Software Engineer");
    expect(md).toContain("$4.50");
  });
});
