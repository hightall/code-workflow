import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";

const CW_DIR = join(homedir(), ".cw");
const DB_PATH = join(CW_DIR, "cw.db");

let _db: DatabaseSync | null = null;

export function getDb(): DatabaseSync {
  if (_db) return _db;

  mkdirSync(CW_DIR, { recursive: true });

  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL");
  _db.exec("PRAGMA foreign_keys = ON");

  _db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id          TEXT PRIMARY KEY,
      workflow_id TEXT NOT NULL,
      workflow_dir TEXT NOT NULL,
      task        TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'running',
      context     TEXT NOT NULL DEFAULT '{}',
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS steps (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES runs(id),
      step_index  INTEGER NOT NULL,
      step_id     TEXT NOT NULL,
      agent_id    TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'waiting',
      input       TEXT NOT NULL DEFAULT '',
      output      TEXT NOT NULL DEFAULT '',
      error       TEXT NOT NULL DEFAULT '',
      story_id    TEXT,
      approved    INTEGER NOT NULL DEFAULT 0,
      attempt     INTEGER NOT NULL DEFAULT 0,
      max_retries INTEGER NOT NULL DEFAULT 0,
      created_at  TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS stories (
      id          TEXT PRIMARY KEY,
      run_id      TEXT NOT NULL REFERENCES runs(id),
      title       TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status      TEXT NOT NULL DEFAULT 'pending',
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  return _db;
}

export function generateId(): string {
  const ts = Date.now().toString(36);
  const rand = Math.random().toString(36).slice(2, 8);
  return `${ts}-${rand}`;
}

// Typed query helpers to work around node:sqlite's generic return types
type SqlParam = string | number | bigint | null | Buffer | Uint8Array;

export function queryOne<T>(sql: string, ...params: SqlParam[]): T | undefined {
  return getDb().prepare(sql).get(...params) as unknown as T | undefined;
}

export function queryAll<T>(sql: string, ...params: SqlParam[]): T[] {
  return getDb().prepare(sql).all(...params) as unknown as T[];
}
