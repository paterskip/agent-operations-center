import { describe, it, expect } from "vitest";
import {
  decisionAllowed,
  isDecisionSatisfied,
  isDecisionAlreadyResolved,
  isAllowedMove,
  DECISION_POLICIES,
  ACTIVE_UNBLOCKED_STATUSES,
} from "./kanban-policy";

describe("kanban-policy (SSOT)", () => {
  describe("decisionAllowed (pre-conditions)", () => {
    it("allows approve/resume only on blocked or scheduled tasks", () => {
      expect(decisionAllowed("approve", "blocked")).toBe(true);
      expect(decisionAllowed("approve", "scheduled")).toBe(true);
      expect(decisionAllowed("approve", "ready")).toBe(false);
      expect(decisionAllowed("approve", "running")).toBe(false);
      expect(decisionAllowed("approve", "review")).toBe(false);

      expect(decisionAllowed("resume", "blocked")).toBe(true);
      expect(decisionAllowed("resume", "scheduled")).toBe(true);
      expect(decisionAllowed("resume", "todo")).toBe(false);
    });

    it("allows reject on blocked, ready, and running tasks", () => {
      expect(decisionAllowed("reject", "blocked")).toBe(true);
      expect(decisionAllowed("reject", "ready")).toBe(true);
      expect(decisionAllowed("reject", "running")).toBe(true);
      expect(decisionAllowed("reject", "done")).toBe(false);
    });

    it("allows hold on todo, ready, and running tasks", () => {
      expect(decisionAllowed("hold", "todo")).toBe(true);
      expect(decisionAllowed("hold", "ready")).toBe(true);
      expect(decisionAllowed("hold", "running")).toBe(true);
      expect(decisionAllowed("hold", "blocked")).toBe(false);
    });

    it("rejects unknown actions", () => {
      expect(decisionAllowed("unknown_action", "blocked")).toBe(false);
    });
  });

  describe("isDecisionSatisfied (post-conditions)", () => {
    it("approve/resume is satisfied for ANY active non-blocked, non-archived status", () => {
      for (const status of ACTIVE_UNBLOCKED_STATUSES) {
        expect(isDecisionSatisfied("approve", status)).toBe(true);
        expect(isDecisionSatisfied("resume", status)).toBe(true);
      }
      expect(isDecisionSatisfied("approve", "blocked")).toBe(false);
      expect(isDecisionSatisfied("approve", "archived")).toBe(false);
    });

    it("reject and hold are satisfied when resulting status is blocked", () => {
      expect(isDecisionSatisfied("reject", "blocked")).toBe(true);
      expect(isDecisionSatisfied("reject", "triage")).toBe(true);
      expect(isDecisionSatisfied("reject", "running")).toBe(false);

      expect(isDecisionSatisfied("hold", "blocked")).toBe(true);
      expect(isDecisionSatisfied("hold", "running")).toBe(false);
    });
  });

  describe("isDecisionAlreadyResolved (idempotency check)", () => {
    it("detects if task was already unblocked before broker execution", () => {
      expect(isDecisionAlreadyResolved("approve", "ready")).toBe(true);
      expect(isDecisionAlreadyResolved("approve", "review")).toBe(true);
      expect(isDecisionAlreadyResolved("approve", "running")).toBe(true);
      expect(isDecisionAlreadyResolved("approve", "blocked")).toBe(false);
    });

    it("detects if task was already blocked for hold/reject", () => {
      expect(isDecisionAlreadyResolved("hold", "blocked")).toBe(true);
      expect(isDecisionAlreadyResolved("hold", "running")).toBe(false);
    });
  });

  describe("isAllowedMove (Kanban DnD rules)", () => {
    it("validates allowed transitions correctly", () => {
      expect(isAllowedMove("todo", "scheduled")).toBe(true);
      expect(isAllowedMove("ready", "running")).toBe(true);
      expect(isAllowedMove("running", "blocked")).toBe(true);
      expect(isAllowedMove("running", "review")).toBe(true);
      expect(isAllowedMove("review", "ready")).toBe(true);

      expect(isAllowedMove("todo", "done")).toBe(false);
      expect(isAllowedMove("blocked", "done")).toBe(false);
      expect(isAllowedMove("done", "running")).toBe(false);
      expect(isAllowedMove("running", "running")).toBe(false);
    });
  });
});
