import { loadConfig } from "../config.js";
import type { Executor } from "./executor.js";
import type { ExecutorParams, ExecutorResult } from "../types.js";

const POLL_INTERVAL_MS = 5000;
const MAX_POLL_TIME_MS = 60 * 60 * 1000; // 1 hour

export class OpenClawExecutor implements Executor {
  async execute(params: ExecutorParams): Promise<ExecutorResult> {
    const config = loadConfig();
    const baseUrl = config.openclawGatewayUrl;

    // Spawn a new session
    const spawnRes = await fetch(`${baseUrl}/api/sessions_spawn`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(config.openclawToken ? { Authorization: `Bearer ${config.openclawToken}` } : {}),
      },
      body: JSON.stringify({
        prompt: params.prompt,
        work_dir: params.workDir,
        model: params.model,
      }),
    });

    if (!spawnRes.ok) {
      const body = await spawnRes.text();
      return {
        success: false,
        output: "",
        error: `OpenClaw spawn failed (${spawnRes.status}): ${body}`,
      };
    }

    const spawnData = (await spawnRes.json()) as { session_id: string };
    const sessionId = spawnData.session_id;

    // Poll for completion
    const startTime = Date.now();
    while (Date.now() - startTime < MAX_POLL_TIME_MS) {
      await sleep(POLL_INTERVAL_MS);

      const statusRes = await fetch(`${baseUrl}/api/session_status?session_id=${sessionId}`, {
        headers: {
          ...(config.openclawToken ? { Authorization: `Bearer ${config.openclawToken}` } : {}),
        },
      });

      if (!statusRes.ok) continue;

      const statusData = (await statusRes.json()) as {
        status: string;
        output?: string;
        error?: string;
      };

      if (statusData.status === "completed") {
        return {
          success: true,
          output: statusData.output || "",
          sessionId,
        };
      }

      if (statusData.status === "failed" || statusData.status === "error") {
        return {
          success: false,
          output: statusData.output || "",
          error: statusData.error || "OpenClaw session failed",
          sessionId,
        };
      }

      // Still running - continue polling
    }

    return {
      success: false,
      output: "",
      error: `OpenClaw session timed out after ${MAX_POLL_TIME_MS / 60000} minutes`,
      sessionId,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
