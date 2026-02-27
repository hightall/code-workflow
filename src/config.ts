import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CwConfig {
  openclawGatewayUrl: string;
  openclawToken: string;
  cursorApiKey: string;
  projectDir: string;
}

export function loadConfig(): CwConfig {
  let openclawToken = "";

  // Try loading from ~/.openclaw/openclaw.json
  const openclawConfigPath = join(homedir(), ".openclaw", "openclaw.json");
  if (existsSync(openclawConfigPath)) {
    try {
      const raw = JSON.parse(readFileSync(openclawConfigPath, "utf-8"));
      openclawToken = raw.token || raw.api_key || "";
    } catch {
      // ignore parse errors
    }
  }

  return {
    openclawGatewayUrl: process.env.OPENCLAW_GATEWAY_URL || "http://localhost:18789",
    openclawToken: process.env.OPENCLAW_TOKEN || openclawToken,
    cursorApiKey: process.env.CURSOR_API_KEY || "",
    projectDir: process.env.CW_PROJECT_DIR || process.cwd(),
  };
}
