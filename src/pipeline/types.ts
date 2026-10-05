/**
 * Deterministic task pipeline: shared types and defaults.
 *
 * Every task from the marketplace scanner is classified into one of the
 * specialties below and scored for expected profit before the agent (and
 * its LLM) ever sees it.
 */

export const CATEGORIES = ["coding", "data", "research", "automation", "content"] as const;
export type Category = (typeof CATEGORIES)[number];
/** "other" = outside our specialties (design, video, physical work...). */
export type Classification = Category | "other";

export const CATEGORY_LABELS: Record<Category, string> = {
  coding: "Coding / Bug fixes",
  data: "Data processing",
  research: "Research / data gathering",
  automation: "Automation / integrations",
  content: "Agent quests / content",
};

export interface PipelineTask {
  platform: string;
  id: string;
  title: string;
  description: string;
  rewardUsd: number;
  /** Fraction of the reward kept by the platform (0.2 = 20%). */
  platformFee: number;
  mode?: string;
  expiresAt?: string;
  /** Submissions/claims already made by other workers, when known. */
  competitors?: number;
  /** True when claiming gives exclusive rights to deliver. */
  exclusive?: boolean;
  tags?: string[];
}

export interface CategoryProfile {
  /** Cumulative input tokens for a typical task (all turns, before caching). */
  inputTokens: number;
  outputTokens: number;
  hours: number;
  /** Prior success probability before we have our own outcomes. */
  baseSuccess: number;
}

export interface ScoreBreakdown {
  category: Classification;
  classifiedBy: "rules" | "llm" | "cache";
  reward: number;
  netReward: number;
  estimatedTokens: number;
  modelCost: number;
  executionHours: number;
  timeCost: number;
  successProbability: number;
  competition: number;
  complexity: number;
  expectedProfit: number;
  /** Why the task was rejected, when it was. */
  rejectReason?: string;
}

export interface CheapModel {
  /** Model id as the inference client knows it (e.g. "llama3.2:3b", "claude-haiku-4-5-20251001"). */
  model: string;
  provider: "ollama" | "anthropic" | "openai" | "gemini";
}

export interface PipelineConfig {
  minExpectedProfitUsd: number;
  /** Opportunity cost of the machine/agent per hour of work. */
  hourlyRateUsd: number;
  /** Model the agent will use to do the work (priced from the registry). */
  workModel: string;
  /** Fraction of input cost saved by Anthropic prompt caching (0..1). */
  promptCacheSavings: number;
  /** Cheap models for classification fallbacks, tried in order. */
  cheapModels: CheapModel[];
  ollamaBaseUrl?: string;
  /**
   * Expected rivals on open (non-exclusive) tasks per platform. A fresh
   * listing shows 0 submissions, but contests fill up later; this floor
   * comes from the platform's history.
   */
  competitorPriors: Record<string, number>;
  profiles: Record<Category, CategoryProfile>;
}

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  minExpectedProfitUsd: 2,
  hourlyRateUsd: 0.25,
  workModel: "claude-sonnet-5-5",
  promptCacheSavings: 0.6,
  cheapModels: [
    { model: "llama3.2:3b", provider: "ollama" },
    { model: "gemini-3.5-flash-lite", provider: "gemini" },
    { model: "claude-haiku-4-5-20251001", provider: "anthropic" },
    { model: "gpt-5-mini", provider: "openai" },
  ],
  ollamaBaseUrl: "http://host.docker.internal:11434",
  // TaskMarket: median of 76 submissions per bounty over 2026-08/10 (191 bounties).
  // TaskBounty: several solvers race each bug; no public history yet.
  // Superteam: rivals per prize slot; its agent bounties drew ~8-74 per slot (2026-10).
  competitorPriors: { taskmarket: 76, taskbounty: 5, superteam: 20 },
  profiles: {
    coding: { inputTokens: 500_000, outputTokens: 40_000, hours: 1.5, baseSuccess: 0.35 },
    data: { inputTokens: 200_000, outputTokens: 25_000, hours: 0.75, baseSuccess: 0.55 },
    research: { inputTokens: 250_000, outputTokens: 25_000, hours: 1, baseSuccess: 0.5 },
    automation: { inputTokens: 400_000, outputTokens: 35_000, hours: 1.5, baseSuccess: 0.35 },
    content: { inputTokens: 100_000, outputTokens: 12_000, hours: 0.5, baseSuccess: 0.5 },
  },
};

export function resolvePipelineConfig(partial?: Partial<PipelineConfig>): PipelineConfig {
  return {
    ...DEFAULT_PIPELINE_CONFIG,
    ...(partial ?? {}),
    competitorPriors: { ...DEFAULT_PIPELINE_CONFIG.competitorPriors, ...(partial?.competitorPriors ?? {}) },
    profiles: { ...DEFAULT_PIPELINE_CONFIG.profiles, ...(partial?.profiles ?? {}) },
  };
}
