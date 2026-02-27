import type { ExecutorType, ExecutorParams, ExecutorResult } from "../types.js";
import { OpenClawExecutor } from "./openclaw.js";
import { CursorExecutor } from "./cursor.js";
import { ManualExecutor } from "./manual.js";

export interface Executor {
  execute(params: ExecutorParams): Promise<ExecutorResult>;
}

const executors: Record<ExecutorType, Executor> = {
  openclaw: new OpenClawExecutor(),
  cursor: new CursorExecutor(),
  manual: new ManualExecutor(),
};

export function getExecutor(type: ExecutorType): Executor {
  const executor = executors[type];
  if (!executor) {
    throw new Error(`Unknown executor type: ${type}`);
  }
  return executor;
}
