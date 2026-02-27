// ── Executor Types ──────────────────────────────────────────────

export type ExecutorType = "openclaw" | "cursor" | "manual";

export interface ExecutorParams {
  prompt: string;
  workDir: string;
  model?: string;
  sessionId?: string;
}

export interface ExecutorResult {
  success: boolean;
  output: string;
  error?: string;
  sessionId?: string;
}

// ── Workflow Spec (parsed from YAML) ────────────────────────────

export interface WorkflowSpec {
  id: string;
  name: string;
  agents: WorkflowAgent[];
  steps: WorkflowStep[];
}

export interface WorkflowAgent {
  id: string;
  name: string;
  executor: ExecutorType;
  role: string;
  model?: string;
  identity?: string;   // path to IDENTITY.md relative to workflow dir
  agents_md?: string;  // path to AGENTS.md relative to workflow dir
}

export interface WorkflowStepLoop {
  over: string;         // e.g. "stories"
  as: string;           // e.g. "story"
  verify_each?: boolean;
}

export interface WorkflowStep {
  id: string;
  agent: string;        // references WorkflowAgent.id
  type?: string;        // "generate" | "verify" | "review"
  loop?: WorkflowStepLoop;
  input: string;        // template with {{key}} placeholders
  approval?: boolean;   // require human approval before execution
  maxRetries?: number;
}

// ── DB Row Types ────────────────────────────────────────────────

export type StepStatus = "waiting" | "pending" | "running" | "approval" | "done" | "failed";
export type RunStatus = "running" | "paused" | "completed" | "failed" | "cancelled";

export interface RunRow {
  id: string;
  workflow_id: string;
  workflow_dir: string;
  task: string;
  status: RunStatus;
  context: string;       // JSON stringified Record<string, string>
  created_at: string;
  updated_at: string;
}

export interface StepRow {
  id: string;
  run_id: string;
  step_index: number;
  step_id: string;       // from WorkflowStep.id
  agent_id: string;
  status: StepStatus;
  input: string;
  output: string;
  error: string;
  story_id: string | null;
  approved: number;
  attempt: number;
  max_retries: number;
  created_at: string;
  updated_at: string;
}

export interface StoryRow {
  id: string;
  run_id: string;
  title: string;
  description: string;
  status: "pending" | "in_progress" | "done" | "failed";
  created_at: string;
}

// ── Event Types ─────────────────────────────────────────────────

export interface WorkflowEvent {
  timestamp: string;
  type: string;
  runId?: string;
  stepId?: string;
  data?: Record<string, unknown>;
}
