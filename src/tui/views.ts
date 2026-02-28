import {
  BOLD, DIM, INVERSE, RESET,
  FG_BLUE, FG_CYAN, FG_GRAY, FG_GREEN, FG_MAGENTA, FG_RED, FG_WHITE, FG_YELLOW,
  colorStatus, stepIcon, runIcon, progressBar, fitText, moveTo,
} from "./ansi.js";
import { renderBox, scrollWindow, type Layout } from "./render.js";
import type { DashboardState, ViewMode } from "./dashboard.js";
import type { RunRow, StepRow, StoryRow } from "../types.js";

// ── Main Dashboard View ────────────────────────────────────────

export function renderMainView(state: DashboardState, layout: Layout): string {
  const runsContent = buildRunsPanel(state);
  const stepsContent = buildStepsPanel(state);
  const detailContent = buildDetailPanel(state, layout.detail.width - 2);
  const actionsContent = buildActionsPanel(state);

  const runsViewportH = layout.runs.height - 2;
  const stepsViewportH = layout.steps.height - 2;

  const [runsStart, runsEnd] = scrollWindow(state.runs.length, state.selectedRunIdx, runsViewportH);
  const [stepsStart, stepsEnd] = scrollWindow(state.steps.length, state.selectedStepIdx, stepsViewportH);

  let out = "";

  out += renderBox(
    layout.runs,
    "Runs",
    runsContent.slice(runsStart, runsEnd),
    state.focusedPanel === "runs",
    { hasAbove: runsStart > 0, hasBelow: runsEnd < state.runs.length },
  ) + "\n";

  out += renderBox(
    layout.steps,
    "Steps",
    stepsContent.slice(stepsStart, stepsEnd),
    state.focusedPanel === "steps",
    { hasAbove: stepsStart > 0, hasBelow: stepsEnd < state.steps.length },
  ) + "\n";

  out += renderBox(
    layout.detail,
    "Detail",
    detailContent,
    false,
  ) + "\n";

  out += renderBox(
    layout.actions,
    "Actions",
    actionsContent,
    false,
  );

  return out;
}

// ── Runs Panel ─────────────────────────────────────────────────

function buildRunsPanel(state: DashboardState): string[] {
  if (state.runs.length === 0) {
    return [`  ${DIM}No runs found${RESET}`];
  }

  return state.runs.map((run, i) => {
    const icon = runIcon(run.status);
    const id = run.id.slice(0, 8);
    const status = colorStatus(run.status);

    // Calculate progress
    const runSteps = state.allSteps.filter(s => s.run_id === run.id);
    const done = runSteps.filter(s => s.status === "done").length;
    const total = runSteps.length;
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;

    const taskPreview = run.task.slice(0, 30);
    const line = ` ${icon} ${id} ${status} ${DIM}${String(pct).padStart(3)}%${RESET} ${DIM}${taskPreview}${RESET}`;

    if (i === state.selectedRunIdx) {
      return `${INVERSE}${line}${RESET}`;
    }
    return line;
  });
}

// ── Steps Panel ────────────────────────────────────────────────

function buildStepsPanel(state: DashboardState): string[] {
  if (state.steps.length === 0) {
    if (state.runs.length === 0) {
      return [`  ${DIM}No runs selected${RESET}`];
    }
    return [`  ${DIM}No steps found${RESET}`];
  }

  return state.steps.map((step, i) => {
    const icon = stepIcon(step.status);
    const status = colorStatus(step.status);
    const agent = `${FG_GRAY}[${step.agent_id}]${RESET}`;
    const storyTag = step.story_id ? ` ${DIM}s:${step.story_id.slice(0, 6)}${RESET}` : "";
    const line = ` ${icon} ${step.step_id.padEnd(10)} ${status} ${agent}${storyTag}`;

    if (i === state.selectedStepIdx) {
      return `${INVERSE}${line}${RESET}`;
    }
    return line;
  });
}

// ── Detail Panel ───────────────────────────────────────────────

function buildDetailPanel(state: DashboardState, width: number): string[] {
  const lines: string[] = [];

  if (state.runs.length === 0) {
    lines.push(`  ${DIM}No run selected${RESET}`);
    return lines;
  }

  const run = state.runs[state.selectedRunIdx];
  if (!run) return lines;

  // Run info
  lines.push(` ${BOLD}Run:${RESET} ${run.id}  ${BOLD}Workflow:${RESET} ${run.workflow_id}`);
  lines.push(` ${BOLD}Task:${RESET} ${run.task}`);

  // Progress
  const runSteps = state.allSteps.filter(s => s.run_id === run.id);
  const done = runSteps.filter(s => s.status === "done").length;
  const total = runSteps.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const barWidth = Math.min(30, Math.max(10, width - 40));
  lines.push(` ${BOLD}Status:${RESET} ${colorStatus(run.status)}  ${BOLD}Progress:${RESET} [${progressBar(done, total, barWidth)}] ${pct}% (${done}/${total})`);

  // Timestamps
  lines.push(` ${BOLD}Created:${RESET} ${run.created_at}  ${BOLD}Updated:${RESET} ${run.updated_at}`);

  // Selected step detail
  const step = state.steps[state.selectedStepIdx];
  if (step) {
    lines.push("");
    lines.push(` ${BOLD}${FG_CYAN}Step:${RESET} ${step.step_id} (${step.id.slice(0, 8)})  ${BOLD}Agent:${RESET} ${step.agent_id}  ${BOLD}Status:${RESET} ${colorStatus(step.status)}`);

    if (step.error) {
      lines.push(` ${FG_RED}Error: ${step.error.slice(0, width - 10)}${RESET}`);
    }

    if (step.output) {
      const preview = step.output.split("\n")[0]?.slice(0, width - 14) || "";
      lines.push(` ${DIM}Output: ${preview}${RESET}`);
    }

    if (step.story_id) {
      const story = state.stories.find(s => s.id === step.story_id);
      if (story) {
        lines.push(` ${DIM}Story: ${story.title}${RESET}`);
      }
    }
  }

  // Stories summary
  if (state.stories.length > 0) {
    const sDone = state.stories.filter(s => s.status === "done").length;
    const sTotal = state.stories.length;
    lines.push("");
    lines.push(` ${BOLD}Stories:${RESET} ${sDone}/${sTotal} done`);
  }

  return lines;
}

// ── Actions Panel ──────────────────────────────────────────────

function buildActionsPanel(state: DashboardState): string[] {
  const parts: string[] = [];

  // Context-aware actions
  const step = state.steps[state.selectedStepIdx];
  const run = state.runs[state.selectedRunIdx];

  if (step?.status === "approval") {
    parts.push(`${BOLD}[a]${RESET}pprove`);
    parts.push(`${BOLD}[r]${RESET}eject`);
  }

  if (run?.status === "running") {
    parts.push(`${BOLD}[s]${RESET}top`);
  }

  if (run && (run.status === "failed" || run.status === "paused")) {
    parts.push(`${BOLD}[R]${RESET}esume`);
  }

  if (step?.output) {
    parts.push(`${BOLD}[o]${RESET}utput`);
  }

  parts.push(`${BOLD}[l]${RESET}ogs`);
  parts.push(`${BOLD}[?]${RESET}help`);
  parts.push(`${BOLD}[q]${RESET}uit`);

  return [" " + parts.join("  ")];
}

// ── Output Viewer ──────────────────────────────────────────────

export function renderOutputView(state: DashboardState, cols: number, rows: number): string {
  const step = state.steps[state.selectedStepIdx];
  if (!step) return renderCenteredMessage("No step selected", cols, rows);

  const title = `Output: ${step.step_id} (${step.id.slice(0, 8)})`;
  const content = step.output || "(no output)";
  const allLines = content.split("\n");

  const viewportH = rows - 4;
  const [start, end] = scrollWindow(allLines.length, state.outputScroll, viewportH);

  let out = `${BOLD}${FG_CYAN} ${title}${RESET}  ${DIM}(Esc=back, Up/Down=scroll, PgUp/PgDn=page)${RESET}\n`;
  out += `${FG_GRAY}${"─".repeat(cols)}${RESET}\n`;

  for (let i = start; i < end; i++) {
    const lineNum = `${FG_GRAY}${String(i + 1).padStart(4)} ${RESET}`;
    const lineContent = allLines[i] || "";
    out += lineNum + fitText(lineContent, cols - 5) + "\n";
  }

  out += `${FG_GRAY}${"─".repeat(cols)}${RESET}\n`;
  out += `${DIM} Line ${state.outputScroll + 1}/${allLines.length}${RESET}`;

  return out;
}

// ── Logs Viewer ────────────────────────────────────────────────

export function renderLogsView(state: DashboardState, cols: number, rows: number): string {
  if (state.logLines.length === 0) return renderCenteredMessage("No events logged yet", cols, rows);

  const viewportH = rows - 4;
  const [start, end] = scrollWindow(state.logLines.length, state.logScroll, viewportH);

  let out = `${BOLD}${FG_CYAN} Event Log${RESET}  ${DIM}(Esc=back, Up/Down=scroll, PgUp/PgDn=page)${RESET}\n`;
  out += `${FG_GRAY}${"─".repeat(cols)}${RESET}\n`;

  for (let i = start; i < end; i++) {
    const event = state.logLines[i];
    if (!event) continue;
    const ts = `${FG_GRAY}${event.timestamp?.slice(11, 19) || ""}${RESET}`;
    const type = `${BOLD}${event.type || ""}${RESET}`;
    const runId = event.runId ? `${DIM}${event.runId.slice(0, 8)}${RESET}` : "";
    const stepId = event.stepId ? `${DIM}${event.stepId.slice(0, 8)}${RESET}` : "";
    const data = event.data ? `${FG_GRAY}${JSON.stringify(event.data).slice(0, cols - 50)}${RESET}` : "";
    out += fitText(` ${ts}  ${type}  ${runId}  ${stepId}  ${data}`, cols) + "\n";
  }

  out += `${FG_GRAY}${"─".repeat(cols)}${RESET}\n`;
  out += `${DIM} Event ${state.logScroll + 1}/${state.logLines.length}${RESET}`;

  return out;
}

// ── Help Overlay ───────────────────────────────────────────────

export function renderHelpView(cols: number, rows: number): string {
  const helpLines = [
    "",
    `${BOLD}${FG_CYAN}  CW Dashboard - Keybindings${RESET}`,
    "",
    `  ${BOLD}Navigation${RESET}`,
    `    Tab / Shift+Tab    Switch panel focus`,
    `    Up / Down          Navigate items`,
    `    Enter / o          View step output`,
    `    l                  View event log`,
    `    ?                  Toggle this help`,
    "",
    `  ${BOLD}Actions${RESET}`,
    `    a                  Approve step (when in approval)`,
    `    r                  Reject step (when in approval)`,
    `    s                  Stop running run`,
    `    R (Shift+R)        Resume failed/paused run`,
    "",
    `  ${BOLD}Overlay Navigation${RESET}`,
    `    Escape             Close overlay / quit`,
    `    Up / Down          Scroll line by line`,
    `    PgUp / PgDn        Scroll by page`,
    `    Home / End         Jump to start / end`,
    "",
    `  ${BOLD}General${RESET}`,
    `    q / Ctrl+C         Quit dashboard`,
    "",
    `  ${DIM}Data refreshes every 1s via SQLite polling${RESET}`,
    "",
  ];

  const boxW = Math.min(56, cols - 4);
  const boxH = helpLines.length + 2;
  const startRow = Math.max(1, Math.floor((rows - boxH) / 2));
  const startCol = Math.max(1, Math.floor((cols - boxW) / 2));

  let out = "";

  // Top border
  out += moveTo(startRow, startCol);
  out += `${FG_CYAN}${BOLD}\u250c${"\u2500".repeat(boxW - 2)}\u2510${RESET}\n`;

  // Content
  for (let i = 0; i < helpLines.length; i++) {
    out += moveTo(startRow + 1 + i, startCol);
    out += `${FG_CYAN}\u2502${RESET}`;
    out += fitText(helpLines[i], boxW - 2);
    out += `${FG_CYAN}\u2502${RESET}`;
  }

  // Bottom border
  out += moveTo(startRow + 1 + helpLines.length, startCol);
  out += `${FG_CYAN}${BOLD}\u2514${"\u2500".repeat(boxW - 2)}\u2518${RESET}`;

  return out;
}

// ── Helpers ────────────────────────────────────────────────────

function renderCenteredMessage(msg: string, cols: number, rows: number): string {
  const row = Math.floor(rows / 2);
  const col = Math.max(1, Math.floor((cols - msg.length) / 2));
  return moveTo(row, col) + DIM + msg + RESET;
}
