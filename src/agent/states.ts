// State definitions (05 §3): goal, model role, max iterations, allowed transitions, instructions.
import type { ModelRole } from "../llm/models.ts";
import type { AgentState } from "./types.ts";

export type StateDef = { goal: string; model: ModelRole; maxIterations: number; next: AgentState[]; instructions: string };

export const STATES: Partial<Record<AgentState, StateDef>> = {
  INVESTIGATE: {
    goal: "Gather data per the triage plan",
    model: "agent_main",
    maxIterations: 12,
    next: ["HYPOTHESIZE", "AWAIT_USER"],
    instructions: `Run the investigation plan. Start from confirmed entities. For code: get_record_automation on the related record type, then search_code/read_code.
For live data (when the tool is available): suiteql_query, get_record, get_execution_logs, get_system_notes, mcp_call.
Log every significant finding with add_evidence (E2 for NetSuite data/logs, E4 only once code/config + mechanism are pinpointed).
Finish once there is enough data to build a hypothesis: complete_state next=HYPOTHESIZE. If access/a user decision is needed: ask_user.`,
  },
  HYPOTHESIZE: {
    goal: "Build/revise ranked hypotheses with confidence",
    model: "agent_main",
    maxIterations: 3,
    next: ["INVESTIGATE", "REPRODUCE", "ROOT_CAUSE", "AWAIT_USER"],
    instructions: `Call update_hypotheses with 1-5 hypotheses (confidence reflects the evidence, supporting/refuting = evidence id).
Then complete_state:
- next=REPRODUCE if the strongest hypothesis is >= 0.5 and the run_repro tool is available and reproducing will add evidence;
- next=ROOT_CAUSE if code/config evidence is already sufficient;
- next=INVESTIGATE if more data is needed (state what, in the summary).`,
  },
  REPRODUCE: {
    goal: "Write the Repro DSL and run reproduce mode",
    model: "agent_main",
    maxIterations: 4,
    next: ["ROOT_CAUSE", "HYPOTHESIZE", "AWAIT_USER"],
    instructions: `Write Repro DSL v1 via write_repro_script: navigate to the record (relative path, e.g. /app/accounting/transactions/vendbill.nl?id=123), wait, assert the initial condition, the triggering action (mark sandboxOnly for write actions), expectError with the error pattern.
Target: prefer {"field": "<fieldid>"} or {"text": "Approve", "role": "button"}. Short caption per step.
Run run_repro. If the symptom appears: add_evidence level 3 with ref.run_id. Then complete_state next=ROOT_CAUSE; if reproduction fails: next=HYPOTHESIZE with the reason.`,
  },
  ROOT_CAUSE: {
    goal: "Pinpoint the specific cause + mechanism",
    model: "agent_main",
    maxIterations: 4,
    next: ["REPORT_DRAFT", "INVESTIGATE", "AWAIT_USER"],
    instructions: `Point the cause to file:line, an SDF object (scriptid), workflow state, or permission, and explain the mechanism step by step.
Log it with add_evidence level 4 (ref required). Mark the proven hypothesis status=accepted via update_hypotheses.
If access is insufficient for E4, write the limitation in the summary and still proceed to REPORT_DRAFT.
Then complete_state next=REPORT_DRAFT.`,
  },
  FIX: {
    goal: "Write a patch on branch nsic/{issueKey}",
    model: "agent_main",
    maxIterations: 8,
    next: ["VALIDATE", "AWAIT_USER"],
    instructions: `Read the relevant code (read_code) then produce a minimal fix as a unified diff (path relative to the repo root, 3 lines of context) via git_branch_and_patch with a rationale.
Do not change anything outside the issue's scope. Run run_tests if available. Then complete_state next=VALIDATE.`,
  },
};

export const STATE_LABEL: Record<AgentState, string> = {
  TRIAGE: "triage", INVESTIGATE: "investigating", HYPOTHESIZE: "hypothesizing", REPRODUCE: "reproducing", ROOT_CAUSE: "root cause",
  REPORT_DRAFT: "drafting report", AWAIT_USER: "awaiting user", CAPTURE: "capturing", FIX: "fixing", VALIDATE: "validating",
  AWAIT_DEPLOY_APPROVAL: "awaiting deploy approval", DEPLOY_SANDBOX: "deploying sandbox", VERIFY: "verifying", DONE: "done", BLOCKED: "blocked", BUDGET_EXCEEDED: "budget exceeded",
};
