import { resolve } from "node:path";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { getDb, generateId, queryOne, queryAll } from "./db.js";
import { emitEvent } from "./events.js";
import { loadWorkflowSpec } from "./workflow-spec.js";
import { loadConfig } from "./config.js";
import { getExecutor } from "./executors/executor.js";
import type {
  RunRow, StepRow, StoryRow, WorkflowStep,
  StepStatus,
} from "./types.js";

// ── Template Resolution ─────────────────────────────────────────

export function resolveTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key: string) => context[key] ?? `{{${key}}}`);
}

// ── Output Parsing ──────────────────────────────────────────────

export function parseOutputKeyValues(output: string): Record<string, string> {
  const kv: Record<string, string> = {};
  for (const line of output.split("\n")) {
    const match = line.match(/^([A-Z_][A-Z0-9_]*)\s*:\s*(.+)$/);
    if (match) {
      kv[match[1].toLowerCase()] = match[2].trim();
    }
  }
  return kv;
}

// ── Run Management ──────────────────────────────────────────────

export function startRun(workflowDir: string, task: string): string {
  const absDir = resolve(workflowDir);
  const spec = loadWorkflowSpec(absDir);
  const db = getDb();
  const runId = generateId();

  const initialContext: Record<string, string> = {
    task,
    workflow_dir: absDir,
    project_dir: loadConfig().projectDir,
  };

  db.prepare(`
    INSERT INTO runs (id, workflow_id, workflow_dir, task, status, context)
    VALUES (?, ?, ?, ?, 'running', ?)
  `).run(runId, spec.id, absDir, task, JSON.stringify(initialContext));

  // Create step rows for all non-loop steps
  for (let i = 0; i < spec.steps.length; i++) {
    const step = spec.steps[i];
    if (step.loop) continue; // loop steps are expanded dynamically

    const stepRowId = generateId();
    const status: StepStatus = i === 0 ? "pending" : "waiting";

    db.prepare(`
      INSERT INTO steps (id, run_id, step_index, step_id, agent_id, status, max_retries)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(stepRowId, runId, i, step.id, step.agent, status, step.maxRetries ?? 0);
  }

  // Also create placeholder rows for loop steps (will be expanded later)
  for (let i = 0; i < spec.steps.length; i++) {
    const step = spec.steps[i];
    if (!step.loop) continue;

    const stepRowId = generateId();
    db.prepare(`
      INSERT INTO steps (id, run_id, step_index, step_id, agent_id, status, max_retries)
      VALUES (?, ?, ?, ?, ?, 'waiting', ?)
    `).run(stepRowId, runId, i, step.id, step.agent, step.maxRetries ?? 0);
  }

  emitEvent({ type: "run.started", runId, data: { task, workflowId: spec.id } });

  // Trigger the first step
  executeNextPendingStep(runId);

  return runId;
}

// ── Step Execution ──────────────────────────────────────────────

export function executeNextPendingStep(runId: string): void {
  const db = getDb();

  // Check run is still active
  const run = queryOne<RunRow>("SELECT * FROM runs WHERE id = ?", runId);
  if (!run || run.status !== "running") return;

  const spec = loadWorkflowSpec(run.workflow_dir);
  const context: Record<string, string> = JSON.parse(run.context);

  // Find next pending step (by step_index order)
  const step = queryOne<StepRow>(
    "SELECT * FROM steps WHERE run_id = ? AND status = 'pending' ORDER BY step_index ASC, id ASC LIMIT 1",
    runId,
  );

  if (!step) return; // nothing pending

  const stepSpec = spec.steps.find((s) => s.id === step.step_id);
  const agentSpec = spec.agents.find((a) => a.id === step.agent_id);
  if (!stepSpec || !agentSpec) {
    failStep(step.id, `Invalid step or agent reference: ${step.step_id} / ${step.agent_id}`);
    return;
  }

  // Check if approval is required (skip if already approved)
  if (stepSpec.approval && !step.approved) {
    db.prepare("UPDATE steps SET status = 'approval', updated_at = datetime('now') WHERE id = ?").run(step.id);
    db.prepare("UPDATE runs SET status = 'paused', updated_at = datetime('now') WHERE id = ?").run(runId);
    emitEvent({ type: "step.approval_required", runId, stepId: step.id, data: { stepName: step.step_id } });
    console.log(`\n⏸  Step '${step.step_id}' requires approval. Run: cw approve ${step.id.slice(0, 8)}`);
    return;
  }

  // Build prompt
  let prompt = resolveTemplate(stepSpec.input, context);

  // Append identity if configured
  if (agentSpec.identity) {
    const identityPath = join(run.workflow_dir, agentSpec.identity);
    if (existsSync(identityPath)) {
      prompt = readFileSync(identityPath, "utf-8") + "\n\n" + prompt;
    }
  }

  // Handle story context for loop iterations
  if (step.story_id) {
    const story = queryOne<StoryRow>("SELECT * FROM stories WHERE id = ?", step.story_id);
    if (story) {
      prompt = prompt.replace(`{{${stepSpec.loop?.as ?? "story"}}}`, `${story.title}\n${story.description}`);
    }
  }

  // Mark as running
  db.prepare("UPDATE steps SET status = 'running', input = ?, attempt = attempt + 1, updated_at = datetime('now') WHERE id = ?")
    .run(prompt, step.id);
  emitEvent({ type: "step.started", runId, stepId: step.id, data: { agent: agentSpec.id, executor: agentSpec.executor } });
  console.log(`\n▶  Running step '${step.step_id}' with ${agentSpec.executor} executor...`);

  // Execute
  const executor = getExecutor(agentSpec.executor);
  executor
    .execute({
      prompt,
      workDir: context.project_dir || run.workflow_dir,
      model: agentSpec.model,
    })
    .then((result) => {
      if (result.success) {
        completeStep(step.id, result.output);
      } else {
        failStep(step.id, result.error || "Executor returned failure");
      }
    })
    .catch((err: Error) => {
      failStep(step.id, err.message);
    });
}

// ── Step Completion ─────────────────────────────────────────────

export function completeStep(stepId: string, output: string): void {
  const db = getDb();

  const step = queryOne<StepRow>("SELECT * FROM steps WHERE id = ?", stepId);
  if (!step) return;

  // Update step
  db.prepare("UPDATE steps SET status = 'done', output = ?, updated_at = datetime('now') WHERE id = ?")
    .run(output, stepId);
  emitEvent({ type: "step.completed", runId: step.run_id, stepId });

  // Update story status if this is a loop iteration
  if (step.story_id) {
    db.prepare("UPDATE stories SET status = 'done' WHERE id = ?").run(step.story_id);
  }

  // Parse output key-values and merge into run context
  const run = queryOne<RunRow>("SELECT * FROM runs WHERE id = ?", step.run_id)!;
  const context: Record<string, string> = JSON.parse(run.context);
  const newKv = parseOutputKeyValues(output);
  Object.assign(context, newKv);

  // Store full output under step name
  const spec = loadWorkflowSpec(run.workflow_dir);
  const stepSpec = spec.steps.find((s) => s.id === step.step_id);
  if (stepSpec) {
    context[`${step.step_id}_output`] = output;
  }

  db.prepare("UPDATE runs SET context = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(context), step.run_id);

  // Parse stories if output contains STORIES_JSON
  if (output.includes("STORIES_JSON:")) {
    parseAndInsertStories(output, step.run_id);
  }

  console.log(`\n✓  Step '${step.step_id}' completed.`);

  // Advance pipeline
  advancePipeline(step.run_id);
}

// ── Pipeline Advancement ────────────────────────────────────────

export function advancePipeline(runId: string): void {
  const db = getDb();
  const run = queryOne<RunRow>("SELECT * FROM runs WHERE id = ?", runId);
  if (!run || run.status !== "running") return;

  const spec = loadWorkflowSpec(run.workflow_dir);

  // Check if all steps are done
  const allSteps = queryAll<StepRow>("SELECT * FROM steps WHERE run_id = ? ORDER BY step_index ASC, id ASC", runId);
  const pendingOrRunning = allSteps.filter((s) => !["done", "failed"].includes(s.status));

  if (pendingOrRunning.length === 0) {
    // All done - check for loop steps that need expansion
    for (const stepSpec of spec.steps) {
      if (!stepSpec.loop) continue;

      // Check if stories still need processing
      const pendingStories = queryAll<StoryRow>(
        "SELECT * FROM stories WHERE run_id = ? AND status = 'pending'",
        runId,
      );

      if (pendingStories.length > 0) {
        expandLoopStep(runId, stepSpec, pendingStories);
        return;
      }
    }

    // Truly all done
    db.prepare("UPDATE runs SET status = 'completed', updated_at = datetime('now') WHERE id = ?").run(runId);
    emitEvent({ type: "run.completed", runId });
    console.log(`\n🏁  Run ${runId} completed!`);
    return;
  }

  // Find waiting steps whose predecessors are all done
  const waitingSteps = allSteps.filter((s) => s.status === "waiting");
  for (const ws of waitingSteps) {
    const priorSteps = allSteps.filter(
      (s) => s.step_index < ws.step_index && s.step_id !== ws.step_id
    );
    const allPriorDone = priorSteps.every((s) => s.status === "done");

    if (allPriorDone) {
      db.prepare("UPDATE steps SET status = 'pending', updated_at = datetime('now') WHERE id = ?").run(ws.id);
    }
  }

  // Execute next pending step
  executeNextPendingStep(runId);
}

// ── Loop Expansion ──────────────────────────────────────────────

function expandLoopStep(runId: string, stepSpec: WorkflowStep, stories: StoryRow[]): void {
  const db = getDb();

  // Remove the placeholder loop step
  db.prepare("DELETE FROM steps WHERE run_id = ? AND step_id = ? AND story_id IS NULL").run(runId, stepSpec.id);

  const existingSteps = queryAll<StepRow>("SELECT * FROM steps WHERE run_id = ? ORDER BY step_index ASC", runId);
  const stepIndex = (existingSteps.length > 0)
    ? Math.max(...existingSteps.map((s) => s.step_index)) + 1
    : 0;

  for (let i = 0; i < stories.length; i++) {
    const story = stories[i];
    const id = generateId();
    db.prepare(`
      INSERT INTO steps (id, run_id, step_index, step_id, agent_id, status, story_id, max_retries)
      VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)
    `).run(id, runId, stepIndex + i, stepSpec.id, stepSpec.agent, story.id, stepSpec.maxRetries ?? 0);

    db.prepare("UPDATE stories SET status = 'in_progress' WHERE id = ?").run(story.id);
  }

  emitEvent({ type: "loop.expanded", runId, data: { stepId: stepSpec.id, count: stories.length } });
  executeNextPendingStep(runId);
}

// ── Stories Parsing ─────────────────────────────────────────────

export function parseAndInsertStories(output: string, runId: string): void {
  const db = getDb();
  const match = output.match(/STORIES_JSON:\s*(\[[\s\S]*?\])/);
  if (!match) return;

  try {
    const stories = JSON.parse(match[1]) as Array<{ title: string; description?: string }>;
    for (const story of stories) {
      const id = generateId();
      db.prepare(`
        INSERT INTO stories (id, run_id, title, description)
        VALUES (?, ?, ?, ?)
      `).run(id, runId, story.title, story.description || "");
    }
    emitEvent({ type: "stories.parsed", runId, data: { count: stories.length } });
  } catch (err) {
    emitEvent({ type: "stories.parse_error", runId, data: { error: String(err) } });
  }
}

// ── Approval ────────────────────────────────────────────────────

export function approveStep(idPrefix: string): void {
  const db = getDb();

  const step = queryOne<StepRow>("SELECT * FROM steps WHERE id LIKE ? AND status = 'approval'", idPrefix + "%");
  if (!step) {
    console.error(`No step awaiting approval matching '${idPrefix}'`);
    return;
  }

  db.prepare("UPDATE steps SET status = 'pending', approved = 1, updated_at = datetime('now') WHERE id = ?").run(step.id);
  db.prepare("UPDATE runs SET status = 'running', updated_at = datetime('now') WHERE id = ?").run(step.run_id);
  emitEvent({ type: "step.approved", runId: step.run_id, stepId: step.id });
  console.log(`✓  Step '${step.step_id}' approved.`);

  executeNextPendingStep(step.run_id);
}

export function rejectStep(idPrefix: string, reason: string): void {
  const db = getDb();

  const step = queryOne<StepRow>("SELECT * FROM steps WHERE id LIKE ? AND status = 'approval'", idPrefix + "%");
  if (!step) {
    console.error(`No step awaiting approval matching '${idPrefix}'`);
    return;
  }

  db.prepare("UPDATE steps SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
    .run(reason, step.id);
  db.prepare("UPDATE runs SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(step.run_id);
  emitEvent({ type: "step.rejected", runId: step.run_id, stepId: step.id, data: { reason } });
  console.log(`✗  Step '${step.step_id}' rejected: ${reason}`);
}

// ── Failure / Retry ─────────────────────────────────────────────

export function failStep(stepId: string, error: string): void {
  const db = getDb();

  const step = queryOne<StepRow>("SELECT * FROM steps WHERE id = ?", stepId);
  if (!step) return;

  emitEvent({ type: "step.failed", runId: step.run_id, stepId, data: { error, attempt: step.attempt } });

  if (step.attempt < step.max_retries) {
    console.log(`\n⟳  Step '${step.step_id}' failed (attempt ${step.attempt}/${step.max_retries}), retrying...`);
    db.prepare("UPDATE steps SET status = 'pending', error = ?, updated_at = datetime('now') WHERE id = ?")
      .run(error, stepId);
    executeNextPendingStep(step.run_id);
  } else {
    console.error(`\n✗  Step '${step.step_id}' failed: ${error}`);
    db.prepare("UPDATE steps SET status = 'failed', error = ?, updated_at = datetime('now') WHERE id = ?")
      .run(error, stepId);
    db.prepare("UPDATE runs SET status = 'failed', updated_at = datetime('now') WHERE id = ?").run(step.run_id);
    emitEvent({ type: "run.failed", runId: step.run_id, data: { stepId, error } });
  }
}

// ── Resume / Stop ───────────────────────────────────────────────

export function resumeRun(runId: string): void {
  const db = getDb();
  const run = queryOne<RunRow>("SELECT * FROM runs WHERE id = ?", runId);
  if (!run) {
    console.error(`Run '${runId}' not found.`);
    return;
  }

  if (run.status === "running") {
    console.log("Run is already active.");
    return;
  }

  // Reset failed steps to pending
  db.prepare("UPDATE steps SET status = 'pending', error = '', updated_at = datetime('now') WHERE run_id = ? AND status = 'failed'")
    .run(runId);
  db.prepare("UPDATE runs SET status = 'running', updated_at = datetime('now') WHERE id = ?").run(runId);
  emitEvent({ type: "run.resumed", runId });
  console.log(`▶  Resuming run ${runId}...`);

  advancePipeline(runId);
}

export function stopRun(runId: string): void {
  const db = getDb();
  const run = queryOne<RunRow>("SELECT * FROM runs WHERE id = ?", runId);
  if (!run) {
    console.error(`Run '${runId}' not found.`);
    return;
  }

  db.prepare("UPDATE runs SET status = 'cancelled', updated_at = datetime('now') WHERE id = ?").run(runId);
  db.prepare("UPDATE steps SET status = 'failed', error = 'cancelled', updated_at = datetime('now') WHERE run_id = ? AND status IN ('pending', 'running', 'waiting')")
    .run(runId);
  emitEvent({ type: "run.cancelled", runId });
  console.log(`⏹  Run ${runId} cancelled.`);
}
