import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

const mockGetAuditLog = vi.hoisted(() => vi.fn(() => [{ id: 1, actor: "ceo", action: "task.create" }]));

vi.mock("@/lib/state", () => ({
  getAuditLog: () => mockGetAuditLog(),
}));

const env = process.env as Record<string, string | undefined>;

beforeEach(() => {
  delete env.AOC_DISABLE_AUTH;
  vi.clearAllMocks();
});

function req(role?: string) {
  return new NextRequest("http://localhost:3010/api/account/security-log", {
    headers: role ? { "x-user-role": role } : {},
  });
}

describe("GET /api/account/security-log — role enforcement", () => {
  it("returns the audit log for the ceo role", async () => {
    const { GET } = await import("./route");
    const res = GET(req("ceo"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.log).toHaveLength(1);
  });

  it("returns 403 for the observer role (read-only, known identity)", async () => {
    const { GET } = await import("./route");
    const res = GET(req("observer"));
    expect(res.status).toBe(403);
    expect(mockGetAuditLog).not.toHaveBeenCalled();
  });

  it("returns 401 when no role header is present", async () => {
    const { GET } = await import("./route");
    const res = GET(req());
    expect(res.status).toBe(401);
    expect(mockGetAuditLog).not.toHaveBeenCalled();
  });

  it("rejects a role the proxy would never issue", async () => {
    const { GET } = await import("./route");
    const res = GET(req("admin"));
    expect(res.status).toBe(401);
  });
});
