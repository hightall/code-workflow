import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import type { WorkflowSpec, WorkflowAgent, WorkflowStep, ExecutorType } from "./types.js";

const VALID_EXECUTORS: ExecutorType[] = ["openclaw", "cursor", "manual"];

export function loadWorkflowSpec(workflowDir: string): WorkflowSpec {
  const ymlPath = join(workflowDir, "workflow.yml");
  const raw = readFileSync(ymlPath, "utf-8");
  const doc = parseYaml(raw);

  if (!doc || typeof doc !== "object") {
    throw new Error(`Invalid workflow.yml in ${workflowDir}`);
  }

  const spec: WorkflowSpec = {
    id: requireString(doc, "id"),
    name: requireString(doc, "name"),
    agents: parseAgents(doc.agents),
    steps: parseSteps(doc.steps),
  };

  validate(spec);
  return spec;
}

function parseAgents(raw: unknown): WorkflowAgent[] {
  if (!Array.isArray(raw)) throw new Error("workflow.yml: 'agents' must be an array");

  return raw.map((a: Record<string, unknown>, i: number) => ({
    id: requireString(a, "id", `agents[${i}]`),
    name: requireString(a, "name", `agents[${i}]`),
    executor: requireString(a, "executor", `agents[${i}]`) as ExecutorType,
    role: requireString(a, "role", `agents[${i}]`),
    model: optionalString(a, "model"),
    identity: optionalString(a, "identity"),
    agents_md: optionalString(a, "agents_md"),
  }));
}

function parseSteps(raw: unknown): WorkflowStep[] {
  if (!Array.isArray(raw)) throw new Error("workflow.yml: 'steps' must be an array");

  return raw.map((s: Record<string, unknown>, i: number) => ({
    id: requireString(s, "id", `steps[${i}]`),
    agent: requireString(s, "agent", `steps[${i}]`),
    type: optionalString(s, "type"),
    loop: s.loop ? parseLoop(s.loop as Record<string, unknown>, i) : undefined,
    input: requireString(s, "input", `steps[${i}]`),
    approval: s.approval === true,
    maxRetries: typeof s.maxRetries === "number" ? s.maxRetries : 0,
  }));
}

function parseLoop(raw: Record<string, unknown>, stepIdx: number) {
  return {
    over: requireString(raw, "over", `steps[${stepIdx}].loop`),
    as: requireString(raw, "as", `steps[${stepIdx}].loop`),
    verify_each: raw.verify_each === true,
  };
}

function validate(spec: WorkflowSpec): void {
  const agentIds = new Set(spec.agents.map((a) => a.id));

  for (const agent of spec.agents) {
    if (!VALID_EXECUTORS.includes(agent.executor)) {
      throw new Error(`Agent '${agent.id}' has invalid executor '${agent.executor}'. Must be one of: ${VALID_EXECUTORS.join(", ")}`);
    }
  }

  for (const step of spec.steps) {
    if (!agentIds.has(step.agent)) {
      throw new Error(`Step '${step.id}' references unknown agent '${step.agent}'`);
    }
  }
}

function requireString(obj: Record<string, unknown>, key: string, ctx?: string): string {
  const val = obj[key];
  if (typeof val !== "string" || val.length === 0) {
    throw new Error(`${ctx ? ctx + ": " : ""}Missing required string field '${key}'`);
  }
  return val;
}

function optionalString(obj: Record<string, unknown>, key: string): string | undefined {
  const val = obj[key];
  return typeof val === "string" ? val : undefined;
}
