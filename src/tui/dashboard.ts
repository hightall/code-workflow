import { readFileSync } from "node:fs";
import {
  ENTER_ALT_SCREEN, EXIT_ALT_SCREEN,
  HIDE_CURSOR, SHOW_CURSOR, CLEAR_SCREEN,
  moveTo,
} from "./ansi.js";
import { startKeyListener, type KeyEvent } from "./input.js";
import { computeLayout } from "./render.js";
import {
  renderMainView, renderOutputView,
  renderLogsView, renderHelpView,
} from "./views.js";
import { queryAll } from "../db.js";
import { getEventsPath } from "../events.js";
import {
  approveStep, rejectStep, resumeRun, stopRun,
} from "../pipeline.js";
import type { RunRow, StepRow, StoryRow, WorkflowEvent } from "../types.js";

// ── State ──────────────────────────────────────────────────────

export type ViewMode = "dashboard" | "output" | "logs" | "help";
export type Panel = "runs" | "steps";

export interface DashboardState {
  viewMode: ViewMode;
  focusedPanel: Panel;
  runs: RunRow[];
  steps: StepRow[];
  stories: StoryRow[];
  allSteps: StepRow[];
  selectedRunIdx: number;
  selectedStepIdx: number;
  selectedRunId: string | null;
  outputScroll: number;
  logScroll: number;
  logLines: WorkflowEvent[];
  cols: number;
  rows: number;
}

function createInitialState(): DashboardState {
  return {
    viewMode: "dashboard",
    focusedPanel: "runs",
    runs: [],
    steps: [],
    stories: [],
    allSteps: [],
    selectedRunIdx: 0,
    selectedStepIdx: 0,
    selectedRunId: null,
    outputScroll: 0,
    logScroll: 0,
    logLines: [],
    cols: process.stdout.columns || 80,
    rows: process.stdout.rows || 24,
  };
}

// ── Data Loading ───────────────────────────────────────────────

function loadData(state: DashboardState): void {
  const prevRunId = state.selectedRunId;

  state.runs = queryAll<RunRow>("SELECT * FROM runs ORDER BY created_at DESC LIMIT 50");
  state.allSteps = queryAll<StepRow>("SELECT * FROM steps ORDER BY step_index ASC, id ASC");

  // Preserve selection by run ID
  if (prevRunId) {
    const idx = state.runs.findIndex(r => r.id === prevRunId);
    if (idx >= 0) {
      state.selectedRunIdx = idx;
    } else {
      state.selectedRunIdx = Math.min(state.selectedRunIdx, Math.max(0, state.runs.length - 1));
    }
  } else {
    state.selectedRunIdx = Math.min(state.selectedRunIdx, Math.max(0, state.runs.length - 1));
  }

  // Update selected run ID
  const selectedRun = state.runs[state.selectedRunIdx];
  state.selectedRunId = selectedRun?.id ?? null;

  // Load steps for selected run
  if (selectedRun) {
    state.steps = state.allSteps.filter(s => s.run_id === selectedRun.id);
    state.stories = queryAll<StoryRow>(
      "SELECT * FROM stories WHERE run_id = ? ORDER BY created_at ASC",
      selectedRun.id,
    );
  } else {
    state.steps = [];
    state.stories = [];
  }

  state.selectedStepIdx = Math.min(state.selectedStepIdx, Math.max(0, state.steps.length - 1));
}

function loadLogs(state: DashboardState): void {
  const eventsPath = getEventsPath();
  try {
    const content = readFileSync(eventsPath, "utf-8");
    const lines = content.trim().split("\n");
    state.logLines = [];
    for (const line of lines) {
      try {
        state.logLines.push(JSON.parse(line) as WorkflowEvent);
      } catch {
        // skip malformed
      }
    }
    // Filter to selected run if one is selected
    if (state.selectedRunId) {
      state.logLines = state.logLines.filter(
        e => !e.runId || e.runId === state.selectedRunId,
      );
    }
  } catch {
    state.logLines = [];
  }
}

// ── Render ─────────────────────────────────────────────────────

function render(state: DashboardState): void {
  state.cols = process.stdout.columns || 80;
  state.rows = process.stdout.rows || 24;

  let frame: string;

  switch (state.viewMode) {
    case "dashboard": {
      const layout = computeLayout(state.cols, state.rows);
      frame = renderMainView(state, layout);
      break;
    }
    case "output":
      frame = renderOutputView(state, state.cols, state.rows);
      break;
    case "logs":
      frame = renderLogsView(state, state.cols, state.rows);
      break;
    case "help": {
      const layout = computeLayout(state.cols, state.rows);
      frame = renderMainView(state, layout);
      frame += renderHelpView(state.cols, state.rows);
      break;
    }
  }

  // Double-buffered write: single stdout.write to minimize flicker
  process.stdout.write(CLEAR_SCREEN + moveTo(1, 1) + frame);
}

// ── Key Handling ───────────────────────────────────────────────

function handleKey(state: DashboardState, key: KeyEvent, cleanup: () => void): void {
  // Global: Ctrl+C or q quits
  if (key.ctrl && key.name === "c") {
    cleanup();
    return;
  }

  switch (state.viewMode) {
    case "dashboard":
      handleDashboardKey(state, key, cleanup);
      break;
    case "output":
      handleOverlayKey(state, key, "outputScroll", getOutputLineCount(state));
      break;
    case "logs":
      handleOverlayKey(state, key, "logScroll", state.logLines.length);
      break;
    case "help":
      if (key.name === "escape" || key.name === "?" || key.name === "q") {
        state.viewMode = "dashboard";
      }
      break;
  }

  render(state);
}

function handleDashboardKey(state: DashboardState, key: KeyEvent, cleanup: () => void): void {
  switch (key.name) {
    case "q":
      cleanup();
      return;

    case "tab":
      state.focusedPanel = key.shift
        ? (state.focusedPanel === "runs" ? "steps" : "runs")
        : (state.focusedPanel === "runs" ? "steps" : "runs");
      break;

    case "up":
      if (state.focusedPanel === "runs") {
        state.selectedRunIdx = Math.max(0, state.selectedRunIdx - 1);
        state.selectedRunId = state.runs[state.selectedRunIdx]?.id ?? null;
        state.selectedStepIdx = 0;
        loadData(state);
      } else {
        state.selectedStepIdx = Math.max(0, state.selectedStepIdx - 1);
      }
      break;

    case "down":
      if (state.focusedPanel === "runs") {
        state.selectedRunIdx = Math.min(state.runs.length - 1, state.selectedRunIdx + 1);
        state.selectedRunId = state.runs[state.selectedRunIdx]?.id ?? null;
        state.selectedStepIdx = 0;
        loadData(state);
      } else {
        state.selectedStepIdx = Math.min(state.steps.length - 1, state.selectedStepIdx + 1);
      }
      break;

    case "left":
      state.focusedPanel = "runs";
      break;

    case "right":
      state.focusedPanel = "steps";
      break;

    case "enter":
    case "o": {
      if (state.steps.length > 0) {
        state.outputScroll = 0;
        state.viewMode = "output";
      }
      break;
    }

    case "l": {
      loadLogs(state);
      state.logScroll = Math.max(0, state.logLines.length - (state.rows - 4));
      state.viewMode = "logs";
      break;
    }

    case "?":
      state.viewMode = "help";
      break;

    case "a": {
      const step = state.steps[state.selectedStepIdx];
      if (step?.status === "approval") {
        try { approveStep(step.id); } catch { /* ignore */ }
        loadData(state);
      }
      break;
    }

    case "r": {
      const step = state.steps[state.selectedStepIdx];
      if (step?.status === "approval") {
        try { rejectStep(step.id, "Rejected from dashboard"); } catch { /* ignore */ }
        loadData(state);
      }
      break;
    }

    case "s": {
      const run = state.runs[state.selectedRunIdx];
      if (run?.status === "running") {
        try { stopRun(run.id); } catch { /* ignore */ }
        loadData(state);
      }
      break;
    }

    case "R": {
      const run = state.runs[state.selectedRunIdx];
      if (run && (run.status === "failed" || run.status === "paused")) {
        try { resumeRun(run.id); } catch { /* ignore */ }
        loadData(state);
      }
      break;
    }
  }
}

function handleOverlayKey(
  state: DashboardState,
  key: KeyEvent,
  scrollProp: "outputScroll" | "logScroll",
  totalLines: number,
): void {
  const pageSize = state.rows - 6;
  const maxScroll = Math.max(0, totalLines - 1);

  switch (key.name) {
    case "escape":
    case "q":
      state.viewMode = "dashboard";
      break;
    case "up":
      state[scrollProp] = Math.max(0, state[scrollProp] - 1);
      break;
    case "down":
      state[scrollProp] = Math.min(maxScroll, state[scrollProp] + 1);
      break;
    case "pageup":
      state[scrollProp] = Math.max(0, state[scrollProp] - pageSize);
      break;
    case "pagedown":
      state[scrollProp] = Math.min(maxScroll, state[scrollProp] + pageSize);
      break;
    case "home":
      state[scrollProp] = 0;
      break;
    case "end":
      state[scrollProp] = maxScroll;
      break;
  }
}

function getOutputLineCount(state: DashboardState): number {
  const step = state.steps[state.selectedStepIdx];
  if (!step?.output) return 0;
  return step.output.split("\n").length;
}

// ── Lifecycle ──────────────────────────────────────────────────

export function startDashboard(): void {
  const state = createInitialState();
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let stopInput: (() => void) | null = null;
  let exiting = false;

  function cleanupAndExit(): void {
    if (exiting) return;
    exiting = true;

    if (pollTimer) clearInterval(pollTimer);
    if (stopInput) stopInput();

    // Restore terminal
    process.stdout.write(EXIT_ALT_SCREEN + SHOW_CURSOR);

    process.exit(0);
  }

  // Enter alternate screen
  process.stdout.write(ENTER_ALT_SCREEN + HIDE_CURSOR);

  // Initial data load + render
  loadData(state);
  render(state);

  // Polling: refresh data every 1s
  pollTimer = setInterval(() => {
    if (state.viewMode === "dashboard" || state.viewMode === "help") {
      loadData(state);
      render(state);
    }
  }, 1000);

  // Keyboard input
  stopInput = startKeyListener((key) => {
    handleKey(state, key, cleanupAndExit);
  });

  // Handle resize
  process.stdout.on("resize", () => {
    state.cols = process.stdout.columns || 80;
    state.rows = process.stdout.rows || 24;
    render(state);
  });

  // Cleanup on unexpected exit
  process.on("SIGINT", cleanupAndExit);
  process.on("SIGTERM", cleanupAndExit);
  process.on("uncaughtException", (err) => {
    process.stdout.write(EXIT_ALT_SCREEN + SHOW_CURSOR);
    console.error("Dashboard error:", err);
    process.exit(1);
  });
}
