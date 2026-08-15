import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/state", () => ({
  getAuditLog: vi.fn(() => [
    {
      id: 1,
      actor: "ceo",
      action: "decision.approve",
      target: "myboard:T-1",
      detail: "Approved",
      ip: "127.0.0.1",
      createdAt: Math.floor(Date.now() / 1000) - 100,
    },
  ]),
  listDecisions: vi.fn(() => [
    {
      id: "dec_1",
      board: "myboard",
      taskId: "T-1",
      action: "approve",
      fromStatus: "blocked",
      toStatus: "ready",
      comment: "Approved task",
      status: "done",
      resultStatus: "ready",
      lastError: null,
      createdAt: Math.floor(Date.now() / 1000) - 100,
      updatedAt: Math.floor(Date.now() / 1000) - 100,
    },
  ]),
}));

describe("GET /api/audit/export", () => {
  it("returns JSON export by default", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost/api/audit/export?days=30");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const j = (await res.json()) as { auditLogs: unknown[]; decisions: unknown[] };
    expect(j.auditLogs).toHaveLength(1);
    expect(j.decisions).toHaveLength(1);
  });

  it("returns CSV export when requested", async () => {
    const { GET } = await import("./route");
    const req = new NextRequest("http://localhost/api/audit/export?format=csv&days=7");
    const res = await GET(req);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("actor_or_board");
    expect(text).toContain("decision.approve");
  });
});
