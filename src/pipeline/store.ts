/**
 * Pipeline persistence: response cache, scored-task history and outcomes.
 *
 * Tables are created on demand (CREATE TABLE IF NOT EXISTS) so the pipeline
 * does not depend on the runtime's migration chain.
 */

import { createHash } from "crypto";
import type BetterSqlite3 from "better-sqlite3";
import type { Category, Classification, PipelineTask, ScoreBreakdown } from "./types.js";

type Database = BetterSqlite3.Database;

const ensured = new WeakSet<Database>();

export function ensurePipelineSchema(db: Database): void {
  if (ensured.has(db)) return;
  db.exec(`
    CREATE TABLE IF NOT EXISTS pipeline_cache (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      expires_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS pipeline_tasks (
      platform TEXT NOT NULL,
      task_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT NOT NULL,
      reward_usd REAL NOT NULL,
      expected_profit REAL NOT NULL,
      breakdown TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'scored',
      actual_cost_cents INTEGER,
      first_seen TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (platform, task_id)
    );
  `);
  ensured.add(db);
}

export function hashKey(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\u0000")).digest("hex");
}

export function cacheGet<T>(db: Database, key: string): T | undefined {
  ensurePipelineSchema(db);
  const row = db
    .prepare("SELECT value, expires_at FROM pipeline_cache WHERE key = ?")
    .get(key) as { value: string; expires_at: number } | undefined;
  if (!row) return undefined;
  if (row.expires_at < Date.now()) {
    db.prepare("DELETE FROM pipeline_cache WHERE key = ?").run(key);
    return undefined;
  }
  return JSON.parse(row.value) as T;
}

export function cacheSet(db: Database, key: string, value: unknown, ttlMs: number): void {
  ensurePipelineSchema(db);
  db.prepare(
    "INSERT OR REPLACE INTO pipeline_cache (key, value, expires_at) VALUES (?, ?, ?)",
  ).run(key, JSON.stringify(value), Date.now() + ttlMs);
}

export function pruneCache(db: Database): number {
  ensurePipelineSchema(db);
  return db.prepare("DELETE FROM pipeline_cache WHERE expires_at < ?").run(Date.now()).changes;
}

/** Record a scored task; an existing row keeps its status and outcome. */
export function upsertScoredTask(db: Database, task: PipelineTask, score: ScoreBreakdown): void {
  ensurePipelineSchema(db);
  db.prepare(
    `INSERT INTO pipeline_tasks (platform, task_id, title, category, reward_usd, expected_profit, breakdown)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(platform, task_id) DO UPDATE SET
       title = excluded.title, category = excluded.category, reward_usd = excluded.reward_usd,
       expected_profit = excluded.expected_profit, breakdown = excluded.breakdown,
       updated_at = datetime('now')`,
  ).run(task.platform, task.id, task.title, score.category, task.rewardUsd, score.expectedProfit, JSON.stringify(score));
}

export const OUTCOMES = ["taken", "won", "lost", "abandoned", "skipped"] as const;
export type Outcome = (typeof OUTCOMES)[number];

export function recordOutcome(
  db: Database,
  platform: string,
  taskId: string,
  outcome: Outcome,
  actualCostCents?: number,
): boolean {
  ensurePipelineSchema(db);
  const result = db
    .prepare(
      `UPDATE pipeline_tasks SET status = ?, actual_cost_cents = COALESCE(?, actual_cost_cents),
       updated_at = datetime('now') WHERE platform = ? AND task_id = ?`,
    )
    .run(outcome, actualCostCents ?? null, platform, taskId);
  return result.changes > 0;
}

export interface CategoryRecord {
  wins: number;
  losses: number;
}

/** Finished tasks per category; abandoned work counts as a loss. */
export function getCategoryRecord(db: Database, category: Classification): CategoryRecord {
  ensurePipelineSchema(db);
  const row = db
    .prepare(
      `SELECT SUM(status = 'won') AS wins, SUM(status IN ('lost', 'abandoned')) AS losses
       FROM pipeline_tasks WHERE category = ?`,
    )
    .get(category) as { wins: number | null; losses: number | null };
  return { wins: row.wins ?? 0, losses: row.losses ?? 0 };
}

export interface QueueRow {
  platform: string;
  task_id: string;
  title: string;
  category: Category;
  reward_usd: number;
  expected_profit: number;
  breakdown: string;
  status: string;
}

export function listQueue(db: Database, minExpectedProfit: number, limit = 20): QueueRow[] {
  ensurePipelineSchema(db);
  return db
    .prepare(
      `SELECT platform, task_id, title, category, reward_usd, expected_profit, breakdown, status
       FROM pipeline_tasks
       WHERE status IN ('scored', 'taken') AND category != 'other' AND expected_profit >= ?
       ORDER BY status = 'taken' DESC, expected_profit DESC LIMIT ?`,
    )
    .all(minExpectedProfit, limit) as QueueRow[];
}
