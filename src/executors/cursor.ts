import { spawn } from "node:child_process";
import { loadConfig } from "../config.js";
import type { Executor } from "./executor.js";
import type { ExecutorParams, ExecutorResult } from "../types.js";

const TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class CursorExecutor implements Executor {
  async execute(params: ExecutorParams): Promise<ExecutorResult> {
    const config = loadConfig();

    const args = [
      "-p",
      "--force",
      "--workspace", params.workDir,
      "--output-format", "json",
      params.prompt,
    ];

    const env: Record<string, string> = { ...process.env as Record<string, string> };
    if (config.cursorApiKey) {
      env.CURSOR_API_KEY = config.cursorApiKey;
    }

    return new Promise<ExecutorResult>((resolve) => {
      const child = spawn("agent", args, {
        env,
        cwd: params.workDir,
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        resolve({
          success: false,
          output: stdout,
          error: `Cursor agent timed out after ${TIMEOUT_MS / 60000} minutes`,
        });
      }, TIMEOUT_MS);

      child.on("close", (code) => {
        clearTimeout(timer);

        if (code === 0) {
          // Try to parse JSON output
          let output = stdout;
          try {
            const json = JSON.parse(stdout);
            output = json.output || json.result || json.message || stdout;
          } catch {
            // Raw text output is fine
          }
          resolve({ success: true, output });
        } else {
          resolve({
            success: false,
            output: stdout,
            error: stderr || `Cursor agent exited with code ${code}`,
          });
        }
      });

      child.on("error", (err: Error) => {
        clearTimeout(timer);
        resolve({
          success: false,
          output: "",
          error: `Failed to spawn cursor agent: ${err.message}`,
        });
      });
    });
  }
}
