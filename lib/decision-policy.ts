import type { DecisionAction } from "./state";

export const decisionTransitions: Record<DecisionAction, { from: readonly string[]; expected: string | null }> = {
  approve: { from: ["blocked", "scheduled"], expected: null },
  reject: { from: ["blocked", "ready", "running"], expected: "blocked" },
  resume: { from: ["blocked", "scheduled"], expected: null },
  hold: { from: ["todo", "ready", "running"], expected: "blocked" },
};

export function decisionAllowed(action: string, status: string): action is DecisionAction {
  return action in decisionTransitions && decisionTransitions[action as DecisionAction].from.includes(status);
}
