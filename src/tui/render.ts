import { BOLD, DIM, FG_CYAN, FG_GRAY, RESET, fitText, visibleLength } from "./ansi.js";

// ── Layout Types ───────────────────────────────────────────────
export interface Rect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Layout {
  runs: Rect;
  steps: Rect;
  detail: Rect;
  actions: Rect;
}

// ── Layout Computation ─────────────────────────────────────────
export function computeLayout(cols: number, rows: number): Layout {
  const leftW = Math.max(20, Math.floor(cols * 0.4));
  const rightW = cols - leftW;
  const topH = Math.max(5, Math.floor((rows - 3) * 0.5));
  const detailH = Math.max(4, rows - topH - 3);
  const actionsH = 3;

  return {
    runs:    { top: 1, left: 1, width: leftW, height: topH },
    steps:   { top: 1, left: leftW + 1, width: rightW, height: topH },
    detail:  { top: topH + 1, left: 1, width: cols, height: detailH },
    actions: { top: topH + detailH + 1, left: 1, width: cols, height: actionsH },
  };
}

// ── Box Drawing ────────────────────────────────────────────────
// Unicode box-drawing: ┌ ─ ┐ │ └ ┘ ├ ┤ ┬ ┴ ┼

export function renderBox(
  rect: Rect,
  title: string,
  lines: string[],
  isFocused: boolean,
  scrollInfo?: { hasAbove: boolean; hasBelow: boolean },
): string {
  const borderColor = isFocused ? FG_CYAN : FG_GRAY;
  const titleStyle = isFocused ? BOLD + FG_CYAN : FG_GRAY;
  const r = RESET;

  const innerW = rect.width - 2;
  const innerH = rect.height - 2;

  let out = "";

  // Scroll indicators in title
  let scrollIndicator = "";
  if (scrollInfo) {
    if (scrollInfo.hasAbove && scrollInfo.hasBelow) scrollIndicator = " \u25b2\u25bc";
    else if (scrollInfo.hasAbove) scrollIndicator = " \u25b2";
    else if (scrollInfo.hasBelow) scrollIndicator = " \u25bc";
  }

  // Top border
  const titleStr = ` ${titleStyle}${title}${r}${borderColor}${scrollIndicator} `;
  const titleVisLen = visibleLength(titleStr);
  const dashCount = Math.max(0, innerW - titleVisLen);
  out += `${borderColor}\u250c\u2500${titleStr}${"\u2500".repeat(dashCount)}\u2510${r}\n`;

  // Content lines
  for (let i = 0; i < innerH; i++) {
    const line = i < lines.length ? lines[i] : "";
    const fitted = fitText(line, innerW);
    out += `${borderColor}\u2502${r}${fitted}${borderColor}\u2502${r}\n`;
  }

  // Bottom border
  out += `${borderColor}\u2514${"\u2500".repeat(innerW)}\u2518${r}`;

  return out;
}

// ── Scroll Window ──────────────────────────────────────────────
export function scrollWindow(
  itemCount: number,
  selectedIdx: number,
  viewportH: number,
): [start: number, end: number] {
  if (itemCount <= viewportH) return [0, itemCount];

  let start = selectedIdx - Math.floor(viewportH / 2);
  if (start < 0) start = 0;
  let end = start + viewportH;
  if (end > itemCount) {
    end = itemCount;
    start = end - viewportH;
  }

  return [start, end];
}
