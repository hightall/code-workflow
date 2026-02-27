import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WorkflowEvent } from "./types.js";

const CW_DIR = join(homedir(), ".cw");
const EVENTS_PATH = join(CW_DIR, "events.jsonl");

export function emitEvent(event: Omit<WorkflowEvent, "timestamp">): void {
  mkdirSync(CW_DIR, { recursive: true });

  const full: WorkflowEvent = {
    timestamp: new Date().toISOString(),
    ...event,
  };

  appendFileSync(EVENTS_PATH, JSON.stringify(full) + "\n");
}

export function getEventsPath(): string {
  return EVENTS_PATH;
}
