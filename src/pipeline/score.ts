/**
 * Expected-profit scoring.
 *
 *   EXPECTED PROFIT = success_probability × net_reward − model_cost − time_cost
 *
 * where
 *   net_reward          = reward × (1 − platform fee)
 *   estimated_tokens    = category profile × complexity
 *   model_cost          = tokens × work-model price (input discounted by prompt caching)
 *   execution_time      = category hours × complexity  → time_cost = hours × hourly rate
 *   success_probability = calibrated category rate × competition factor × deadline factor
 *
 * Model and time costs are paid whether or not the work is accepted, which
 * is why they are not multiplied by the success probability.
 */

import type { CategoryRecord } from "./store.js";
import type {
  Classification,
  PipelineConfig,
  PipelineTask,
  ScoreBreakdown,
} from "./types.js";

/** Registry prices are hundredths of a cent per 1k tokens (20 = $2.00/M). */
export interface ModelPrice {
  costPer1kInput: number;
  costPer1kOutput: number;
}

const HARD_SIGNALS = [
  /\bhard\b/i, /several (focused )?days/i, /multi-?day/i, /\bfull stack\b/i, /end[- ]to[- ]end/i,
  /\bproduction\b/i, /\baudit(ed)?\b/i, /\bfrom scratch\b/i, /\bconformance\b/i, /\bfive languages\b/i,
];
const EASY_SIGNALS = [/\bsimple\b/i, /\bsmall\b/i, /\bquick\b/i, /\bone[- ]line\b/i, /\btypo\b/i, /\bminor\b/i];

/** Task size multiplier from length and wording, clamped to [0.5, 3]. */
export function estimateComplexity(task: PipelineTask): number {
  const text = `${task.title}\n${task.description}`;
  let factor = 1;
  if (task.description.length > 3000) factor *= 1.5;
  else if (task.description.length < 400) factor *= 0.8;
  factor *= 1 + 0.5 * HARD_SIGNALS.filter((re) => re.test(text)).length;
  factor *= Math.pow(0.8, EASY_SIGNALS.filter((re) => re.test(text)).length);
  return Math.min(3, Math.max(0.5, factor));
}

/**
 * Probability of beating other workers. Exclusive claims face no rivals;
 * open bounties lose ground with every known competitor; pitch/auction
 * modes and multi-solver platforms are winner-takes-all races.
 *
 * `expectedCompetitors` is the platform's historical floor: a contest that
 * was just posted shows few submissions but will fill up before it closes.
 */
export function competitionFactor(task: PipelineTask, expectedCompetitors = 0): number {
  if (task.exclusive) return 1;
  let factor = task.mode === "pitch" || task.mode === "auction" ? 0.4 : 0.7;
  const competitors = Math.max(task.competitors ?? 0, expectedCompetitors);
  if (competitors > 0) factor /= 1 + 0.5 * competitors;
  return factor;
}

/** Beta-binomial update: the prior counts as 4 pseudo-tasks. */
export function calibratedSuccess(base: number, record: CategoryRecord): number {
  const priorWeight = 4;
  return (base * priorWeight + record.wins) / (priorWeight + record.wins + record.losses);
}

export function scoreTask(params: {
  task: PipelineTask;
  category: Classification;
  classifiedBy: ScoreBreakdown["classifiedBy"];
  config: PipelineConfig;
  price: ModelPrice;
  record: CategoryRecord;
  now?: Date;
}): ScoreBreakdown {
  const { task, category, classifiedBy, config, price, record } = params;
  const netReward = task.rewardUsd * (1 - task.platformFee);
  const base = {
    category,
    classifiedBy,
    reward: task.rewardUsd,
    netReward,
  };

  if (category === "other") {
    return {
      ...base,
      estimatedTokens: 0,
      modelCost: 0,
      executionHours: 0,
      timeCost: 0,
      successProbability: 0,
      competition: 0,
      complexity: 0,
      expectedProfit: 0,
      rejectReason: "fuera de nuestras especialidades",
    };
  }

  const profile = config.profiles[category];
  const complexity = estimateComplexity(task);
  const inputTokens = profile.inputTokens * complexity;
  const outputTokens = profile.outputTokens * complexity;
  const inputUsd = (inputTokens / 1000) * (price.costPer1kInput / 10_000) * (1 - config.promptCacheSavings);
  const outputUsd = (outputTokens / 1000) * (price.costPer1kOutput / 10_000);
  const modelCost = inputUsd + outputUsd;

  const executionHours = profile.hours * complexity;
  const timeCost = executionHours * config.hourlyRateUsd;

  const competition = competitionFactor(task, config.competitorPriors[task.platform] ?? 0);
  let successProbability = calibratedSuccess(profile.baseSuccess, record) * competition;

  let rejectReason: string | undefined;
  if (task.expiresAt) {
    const hoursLeft = (new Date(task.expiresAt).getTime() - (params.now ?? new Date()).getTime()) / 3_600_000;
    // Need twice the estimated time as a safety margin.
    if (hoursLeft < executionHours * 2) {
      successProbability *= 0.1;
      rejectReason = `vence en ${Math.max(0, hoursLeft).toFixed(1)} h; se estiman ${executionHours.toFixed(1)} h`;
    }
  }

  const expectedProfit = successProbability * netReward - modelCost - timeCost;
  if (!rejectReason && expectedProfit < config.minExpectedProfitUsd) {
    rejectReason = `ganancia esperada $${expectedProfit.toFixed(2)} < mínimo $${config.minExpectedProfitUsd.toFixed(2)}`;
  }

  return {
    ...base,
    estimatedTokens: Math.round(inputTokens + outputTokens),
    modelCost,
    executionHours,
    timeCost,
    successProbability,
    competition,
    complexity,
    expectedProfit,
    rejectReason,
  };
}

export function formatBreakdown(s: ScoreBreakdown): string {
  return (
    `EP $${s.expectedProfit.toFixed(2)} = ${(s.successProbability * 100).toFixed(0)}% × $${s.netReward.toFixed(2)} neto` +
    ` − IA $${s.modelCost.toFixed(2)} (~${Math.round(s.estimatedTokens / 1000)}k tokens)` +
    ` − tiempo $${s.timeCost.toFixed(2)} (${s.executionHours.toFixed(1)} h)` +
    ` · competencia ×${s.competition.toFixed(2)} · complejidad ×${s.complexity.toFixed(1)}`
  );
}
