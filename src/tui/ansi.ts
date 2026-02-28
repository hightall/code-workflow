// ── Screen Control ─────────────────────────────────────────────
export const ENTER_ALT_SCREEN = "\x1b[?1049h";
export const EXIT_ALT_SCREEN = "\x1b[?1049l";
export const HIDE_CURSOR = "\x1b[?25l";
export const SHOW_CURSOR = "\x1b[?25h";
export const CLEAR_SCREEN = "\x1b[2J";

// ── Cursor ─────────────────────────────────────────────────────
export function moveTo(row: number, col: number): string {
  return `\x1b[${row};${col}H`;
}

// ── Colors / Styles ────────────────────────────────────────────
export const RESET = "\x1b[0m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const INVERSE = "\x1b[7m";

export const FG_RED = "\x1b[31m";
export const FG_GREEN = "\x1b[32m";
export const FG_YELLOW = "\x1b[33m";
export const FG_BLUE = "\x1b[34m";
export const FG_MAGENTA = "\x1b[35m";
export const FG_CYAN = "\x1b[36m";
export const FG_GRAY = "\x1b[90m";
export const FG_WHITE = "\x1b[37m";

// ── ANSI Stripping ─────────────────────────────────────────────
const ANSI_RE = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export function visibleLength(s: string): number {
  return stripAnsi(s).length;
}

// ── Text Fitting ───────────────────────────────────────────────
export function fitText(s: string, width: number): string {
  const plain = stripAnsi(s);
  if (plain.length <= width) {
    return s + " ".repeat(width - plain.length);
  }
  // Truncate: we must walk the original string, tracking visible chars
  let vis = 0;
  let i = 0;
  while (i < s.length && vis < width - 1) {
    if (s[i] === "\x1b") {
      const end = s.indexOf("m", i);
      if (end !== -1) {
        i = end + 1;
        continue;
      }
    }
    vis++;
    i++;
  }
  return s.slice(0, i) + "\u2026" + RESET;
}

// ── Status Coloring ────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  running: FG_BLUE,
  paused: FG_YELLOW,
  completed: FG_GREEN,
  failed: FG_RED,
  cancelled: FG_GRAY,
  waiting: FG_GRAY,
  pending: FG_CYAN,
  approval: FG_MAGENTA,
  done: FG_GREEN,
  in_progress: FG_BLUE,
};

export function colorStatus(status: string): string {
  return `${STATUS_COLORS[status] || ""}${status}${RESET}`;
}

// ── Step / Run Icons ───────────────────────────────────────────
export function stepIcon(status: string): string {
  switch (status) {
    case "done": return `${FG_GREEN}\u2713${RESET}`;
    case "running": return `${FG_BLUE}\u25b6${RESET}`;
    case "approval": return `${FG_MAGENTA}\u23f8${RESET}`;
    case "failed": return `${FG_RED}\u2717${RESET}`;
    case "pending": return `${FG_CYAN}\u25cb${RESET}`;
    default: return `${FG_GRAY}\u00b7${RESET}`;
  }
}

export function runIcon(status: string): string {
  switch (status) {
    case "completed": return `${FG_GREEN}\u2713${RESET}`;
    case "running": return `${FG_BLUE}\u25b6${RESET}`;
    case "paused": return `${FG_YELLOW}\u23f8${RESET}`;
    case "failed": return `${FG_RED}\u2717${RESET}`;
    case "cancelled": return `${FG_GRAY}\u2715${RESET}`;
    default: return `${FG_GRAY}\u00b7${RESET}`;
  }
}

// ── Progress Bar ───────────────────────────────────────────────
export function progressBar(done: number, total: number, width: number): string {
  if (total === 0) return FG_GRAY + "\u2591".repeat(width) + RESET;
  const pct = done / total;
  const filled = Math.round(pct * width);
  return (
    FG_GREEN + "\u2588".repeat(filled) + RESET +
    FG_GRAY + "\u2591".repeat(width - filled) + RESET
  );
}
