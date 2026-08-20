import type { TaskStatus } from "./types";

export type DecisionAction = "approve" | "reject" | "resume" | "hold";

export interface DecisionPolicy {
  readonly allowedFrom: readonly string[];
  readonly expected: string | null;
  readonly description: string;
  isPostConditionSatisfied: (status: string) => boolean;
  isAlreadyResolved: (currentStatus: string) => boolean;
}

export const ACTIVE_UNBLOCKED_STATUSES: readonly string[] = [
  "todo",
  "scheduled",
  "ready",
  "running",
  "review",
  "done",
] as const;

export const DECISION_POLICIES: Record<DecisionAction, DecisionPolicy> = {
  approve: {
    allowedFrom: ["blocked", "scheduled"],
    expected: null,
    description: "Odblokowanie zadania i przekazanie do dalszej pracy",
    isPostConditionSatisfied: (status: string) => status !== "blocked" && status !== "archived",
    isAlreadyResolved: (currentStatus: string) =>
      currentStatus !== "blocked" && currentStatus !== "archived" && currentStatus !== "scheduled",
  },
  resume: {
    allowedFrom: ["blocked", "scheduled"],
    expected: null,
    description: "Wznowienie zablokowanego lub zaplanowanego zadania",
    isPostConditionSatisfied: (status: string) => status !== "blocked" && status !== "archived",
    isAlreadyResolved: (currentStatus: string) =>
      currentStatus !== "blocked" && currentStatus !== "archived" && currentStatus !== "scheduled",
  },
  reject: {
    allowedFrom: ["blocked", "ready", "running"],
    expected: "blocked",
    description: "Odrzucenie zadania lub pozostawienie w stanie zablokowanym z komentarzem",
    isPostConditionSatisfied: (status: string) => status === "blocked" || status === "triage",
    isAlreadyResolved: (currentStatus: string) => currentStatus === "blocked",
  },
  hold: {
    allowedFrom: ["todo", "ready", "running"],
    expected: "blocked",
    description: "Wstrzymanie i zablokowanie zadania",
    isPostConditionSatisfied: (status: string) => status === "blocked",
    isAlreadyResolved: (currentStatus: string) => currentStatus === "blocked",
  },
};

/**
 * Zgodność wsteczna z lib/decision-policy.ts
 */
export const decisionTransitions: Record<DecisionAction, { from: readonly string[]; expected: string | null }> = {
  approve: { from: DECISION_POLICIES.approve.allowedFrom, expected: null },
  reject: { from: DECISION_POLICIES.reject.allowedFrom, expected: "blocked" },
  resume: { from: DECISION_POLICIES.resume.allowedFrom, expected: null },
  hold: { from: DECISION_POLICIES.hold.allowedFrom, expected: "blocked" },
};

export function decisionAllowed(action: string, status: string): action is DecisionAction {
  if (action in DECISION_POLICIES) {
    // SAFETY: The action is confirmed to be a key of DECISION_POLICIES via 'in' check
    const act = action as DecisionAction;
    return DECISION_POLICIES[act].allowedFrom.includes(status);
  }
  return false;
}

export function isDecisionSatisfied(action: DecisionAction, resultingStatus: string): boolean {
  const policy = DECISION_POLICIES[action];
  return policy ? policy.isPostConditionSatisfied(resultingStatus) : false;
}

export function isDecisionAlreadyResolved(action: DecisionAction, currentStatus: string): boolean {
  const policy = DECISION_POLICIES[action];
  return policy ? policy.isAlreadyResolved(currentStatus) : false;
}

export const KANBAN_ALLOWED_DROPS: Record<string, string[]> = {
  triage: [],
  todo: ["scheduled"],
  scheduled: [],
  ready: ["running"],
  running: ["blocked", "review"],
  blocked: [],
  review: ["ready"],
  done: [],
};

export function isAllowedMove(from: string, to: string): boolean {
  if (from === to) return false;
  return (KANBAN_ALLOWED_DROPS[from] || []).includes(to);
}
