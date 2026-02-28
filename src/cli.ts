#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDb, queryOne, queryAll } from "./db.js";
import { getEventsPath } from "./events.js";
import {
  startRun,
  approveStep,
  rejectStep,
  resumeRun,
  stopRun,
} from "./pipeline.js";
import type { RunRow, StepRow, StoryRow } from "./types.js";

const args = process.argv.slice(2);
const command = args[0];

// ── Color Helpers ───────────────────────────────────────────────

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

const STATUS_COLORS: Record<string, string> = {
  running: c.blue,
  paused: c.yellow,
  completed: c.green,
  failed: c.red,
  cancelled: c.dim,
  waiting: c.dim,
  pending: c.cyan,
  approval: c.magenta,
  done: c.green,
};

function colorStatus(status: string): string {
  return `${STATUS_COLORS[status] || ""}${status}${c.reset}`;
}

// ── Commands ────────────────────────────────────────────────────

switch (command) {
  case "run": {
    const workflowDir = args[1];
    const task = args[2];
    if (!workflowDir || !task) {
      console.error("Usage: cw run <workflow-dir> \"<task>\"");
      process.exit(1);
    }
    const runId = startRun(resolve(workflowDir), task);
    console.log(`\n${c.bold}Run started:${c.reset} ${runId}`);
    break;
  }

  case "status": {
    const query = args[1];
    showStatus(query);
    break;
  }

  case "runs": {
    showRuns();
    break;
  }

  case "approve": {
    const idPrefix = args[1];
    if (!idPrefix) {
      console.error("Usage: cw approve <step-id-prefix>");
      process.exit(1);
    }
    approveStep(idPrefix);
    break;
  }

  case "reject": {
    const idPrefix = args[1];
    const reason = args.slice(2).join(" ") || "Rejected";
    if (!idPrefix) {
      console.error("Usage: cw reject <step-id-prefix> [reason]");
      process.exit(1);
    }
    rejectStep(idPrefix, reason);
    break;
  }

  case "logs": {
    const runId = args[1];
    showLogs(runId);
    break;
  }

  case "stories": {
    const runId = args[1];
    if (!runId) {
      console.error("Usage: cw stories <run-id>");
      process.exit(1);
    }
    showStories(runId);
    break;
  }

  case "resume": {
    const runId = args[1];
    if (!runId) {
      console.error("Usage: cw resume <run-id>");
      process.exit(1);
    }
    resumeRun(runId);
    break;
  }

  case "stop": {
    const runId = args[1];
    if (!runId) {
      console.error("Usage: cw stop <run-id>");
      process.exit(1);
    }
    stopRun(runId);
    break;
  }

  case "dashboard":
  case "ui": {
    const { startDashboard } = await import("./tui/dashboard.js");
    startDashboard();
    break;
  }

  case "help":
  case "--help":
  case "-h":
  case undefined: {
    printHelp();
    break;
  }

  default: {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }
}

// ── Status Display ──────────────────────────────────────────────

function showStatus(query?: string): void {
  let run: RunRow | undefined;
  if (query) {
    run = queryOne<RunRow>("SELECT * FROM runs WHERE id LIKE ?", query + "%");
  } else {
    run = queryOne<RunRow>("SELECT * FROM runs ORDER BY created_at DESC LIMIT 1");
  }

  if (!run) {
    console.log("No runs found.");
    return;
  }

  console.log(`\n${c.bold}Run:${c.reset} ${run.id}`);
  console.log(`${c.bold}Task:${c.reset} ${run.task}`);
  console.log(`${c.bold}Status:${c.reset} ${colorStatus(run.status)}`);
  console.log(`${c.bold}Started:${c.reset} ${run.created_at}`);
  console.log();

  const steps = queryAll<StepRow>(
    "SELECT * FROM steps WHERE run_id = ? ORDER BY step_index ASC, id ASC",
    run.id,
  );

  const doneCount = steps.filter((s) => s.status === "done").length;
  const total = steps.length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;
  const barLen = 30;
  const filled = Math.round((doneCount / Math.max(total, 1)) * barLen);
  const bar = "█".repeat(filled) + "░".repeat(barLen - filled);

  console.log(`  ${c.bold}Progress:${c.reset} [${c.green}${bar}${c.reset}] ${pct}% (${doneCount}/${total})`);
  console.log();

  for (const step of steps) {
    const icon = step.status === "done" ? "✓" :
                 step.status === "running" ? "▶" :
                 step.status === "approval" ? "⏸" :
                 step.status === "failed" ? "✗" :
                 step.status === "pending" ? "○" : "·";
    const storyInfo = step.story_id ? ` [story:${step.story_id.slice(0, 6)}]` : "";
    console.log(`  ${icon} ${c.bold}${step.step_id}${c.reset} ${colorStatus(step.status)}${storyInfo}`);
    if (step.error) {
      console.log(`    ${c.red}Error: ${step.error}${c.reset}`);
    }
  }

  console.log();
}

function showRuns(): void {
  const runs = queryAll<RunRow>("SELECT * FROM runs ORDER BY created_at DESC LIMIT 20");

  if (runs.length === 0) {
    console.log("No runs found.");
    return;
  }

  console.log(`\n${c.bold}Recent Runs:${c.reset}\n`);
  for (const run of runs) {
    const steps = queryAll<{ status: string }>("SELECT status FROM steps WHERE run_id = ?", run.id);
    const done = steps.filter((s) => s.status === "done").length;
    console.log(`  ${run.id.slice(0, 12)}  ${colorStatus(run.status).padEnd(20)}  ${done}/${steps.length} steps  ${c.dim}${run.task.slice(0, 50)}${c.reset}`);
  }
  console.log();
}

function showLogs(runId?: string): void {
  const eventsPath = getEventsPath();
  let content: string;
  try {
    content = readFileSync(eventsPath, "utf-8");
  } catch {
    console.log("No events logged yet.");
    return;
  }

  const lines = content.trim().split("\n");
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (runId && event.runId && !event.runId.startsWith(runId)) continue;
      console.log(`${c.dim}${event.timestamp}${c.reset}  ${c.bold}${event.type}${c.reset}  ${event.runId?.slice(0, 8) || ""}  ${event.stepId?.slice(0, 8) || ""}  ${event.data ? JSON.stringify(event.data) : ""}`);
    } catch {
      // skip malformed lines
    }
  }
}

function showStories(runId: string): void {
  const stories = queryAll<StoryRow>("SELECT * FROM stories WHERE run_id = ? ORDER BY created_at ASC", runId);

  if (stories.length === 0) {
    console.log("No stories found for this run.");
    return;
  }

  console.log(`\n${c.bold}Stories:${c.reset}\n`);
  for (const story of stories) {
    const icon = story.status === "done" ? "✓" : story.status === "in_progress" ? "▶" : "○";
    console.log(`  ${icon} ${c.bold}${story.title}${c.reset} ${colorStatus(story.status)}`);
    if (story.description) {
      console.log(`    ${c.dim}${story.description.slice(0, 80)}${c.reset}`);
    }
  }
  console.log();
}

function printHelp(): void {
  console.log(`
${c.bold}cw${c.reset} - Code Workflow orchestration engine

${c.bold}Usage:${c.reset}
  cw run <workflow-dir> "<task>"     Start a workflow run
  cw status [run-id-prefix]          Show run progress
  cw runs                            List all runs
  cw approve <step-id-prefix>        Approve a pending step
  cw reject <step-id-prefix> [msg]   Reject a pending step
  cw logs [run-id-prefix]            View event logs
  cw stories <run-id>                View stories for a run
  cw resume <run-id>                 Resume a failed run
  cw stop <run-id>                   Cancel a running run
  cw dashboard | ui                  Interactive TUI dashboard
`);
}
