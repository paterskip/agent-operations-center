import { describe, expect, it } from "vitest";
import { decisionAllowed, decisionTransitions } from "./decision-policy";

describe("CEO decision policy", () => {
  it("only resumes blocked or scheduled tasks", () => {
    expect(decisionAllowed("approve", "blocked")).toBe(true);
    expect(decisionAllowed("approve", "scheduled")).toBe(true);
    expect(decisionAllowed("approve", "triage")).toBe(true);
    expect(decisionAllowed("approve", "todo")).toBe(true);
    expect(decisionAllowed("approve", "review")).toBe(false);
    expect(decisionAllowed("approve", "done")).toBe(false);
  });


  it("never exposes assignment or forced dependency actions", () => {
    expect(decisionAllowed("assign", "blocked")).toBe(false);
    expect(decisionAllowed("force", "todo")).toBe(false);
    expect(Object.keys(decisionTransitions)).toEqual(["approve", "reject", "resume", "hold"]);
  });

  it("requires review cards to stay in the native Hermes workflow", () => {
    for (const action of Object.keys(decisionTransitions)) expect(decisionAllowed(action, "review")).toBe(false);
  });
});
