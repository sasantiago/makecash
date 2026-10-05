/**
 * Pipeline entry point: classify → score → persist.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import type BetterSqlite3 from "better-sqlite3";
import type { AutomatonConfig } from "../types.js";
import { ModelRegistry } from "../inference/registry.js";
import { classifyByRules, isConfident } from "./classify.js";
import { classifyWithLlm, type ProviderKeys } from "./llm.js";
import { scoreTask, type ModelPrice } from "./score.js";
import { getCategoryRecord, upsertScoredTask } from "./store.js";
import {
  CATEGORY_LABELS,
  resolvePipelineConfig,
  type Category,
  type Classification,
  type PipelineConfig,
  type PipelineTask,
  type ScoreBreakdown,
} from "./types.js";

/** Sonnet-class fallback price when the work model is not in the registry. */
const FALLBACK_PRICE: ModelPrice = { costPer1kInput: 20, costPer1kOutput: 100 };

export interface ScoredTask {
  task: PipelineTask;
  score: ScoreBreakdown;
}

export function pipelineFromAutomatonConfig(config: AutomatonConfig): {
  pipeline: PipelineConfig;
  keys: ProviderKeys;
} {
  const pipeline = resolvePipelineConfig(config.pipeline);
  return {
    pipeline,
    keys: {
      anthropicApiKey: config.anthropicApiKey,
      openaiApiKey: config.openaiApiKey,
      geminiApiKey: config.geminiApiKey,
      ollamaBaseUrl: pipeline.ollamaBaseUrl || config.ollamaBaseUrl,
    },
  };
}

export async function evaluateTasks(
  db: BetterSqlite3.Database,
  tasks: PipelineTask[],
  pipeline: PipelineConfig,
  keys: ProviderKeys,
): Promise<ScoredTask[]> {
  let price = FALLBACK_PRICE;
  try {
    const entry = new ModelRegistry(db).get(pipeline.workModel);
    if (entry) price = { costPer1kInput: entry.costPer1kInput, costPer1kOutput: entry.costPer1kOutput };
  } catch {
    // Registry table missing (fresh DB): keep the fallback price.
  }

  const scored: ScoredTask[] = [];
  for (const task of tasks) {
    const text = `${task.title}\n${(task.tags ?? []).join(" ")}\n${task.description}`;
    const rules = classifyByRules(text);
    let category: Classification = rules.category;
    let classifiedBy: ScoreBreakdown["classifiedBy"] = "rules";

    if (!isConfident(rules)) {
      const llm = await classifyWithLlm(db, text, pipeline.cheapModels, keys);
      if (llm) {
        category = llm.category;
        classifiedBy = llm.source;
      }
    }

    const score = scoreTask({
      task,
      category,
      classifiedBy,
      config: pipeline,
      price,
      record: getCategoryRecord(db, category),
    });
    upsertScoredTask(db, task, score);
    scored.push({ task, score });
  }
  return scored.sort((a, b) => b.score.expectedProfit - a.score.expectedProfit);
}

export function isWorthIt(s: ScoredTask, pipeline: PipelineConfig): boolean {
  return (
    s.score.category !== "other" &&
    !s.score.rejectReason &&
    s.score.expectedProfit >= pipeline.minExpectedProfitUsd
  );
}

const PLAYBOOK_DIRS = [
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "playbooks"),
  "/app/playbooks",
];

/** The category's working playbook (deterministic steps for the agent). */
export function loadPlaybook(category: Category): string {
  for (const dir of PLAYBOOK_DIRS) {
    const file = path.join(dir, `${category}.md`);
    if (fs.existsSync(file)) return fs.readFileSync(file, "utf8").trim();
  }
  return `Sin playbook para ${CATEGORY_LABELS[category]}.`;
}
