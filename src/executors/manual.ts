import type { Executor } from "./executor.js";
import type { ExecutorParams, ExecutorResult } from "../types.js";

/**
 * Manual executor - does not actually execute anything.
 * Steps using this executor go through the approval flow in the pipeline.
 * When approved, they complete with the approval as output.
 */
export class ManualExecutor implements Executor {
  async execute(_params: ExecutorParams): Promise<ExecutorResult> {
    // Manual steps are handled by the pipeline's approval logic.
    // If we reach here, it means the step was approved and should just pass through.
    return {
      success: true,
      output: "Manually approved.",
    };
  }
}
