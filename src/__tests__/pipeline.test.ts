import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyByRules, isConfident } from "../pipeline/classify.js";
import { evaluateTasks, isWorthIt } from "../pipeline/evaluate.js";
import { classifyWithLlm } from "../pipeline/llm.js";
import {
  calibratedSuccess,
  competitionFactor,
  estimateComplexity,
  formatBreakdown,
  scoreTask,
} from "../pipeline/score.js";
import {
  cacheGet,
  cacheSet,
  getCategoryRecord,
  listQueue,
  recordOutcome,
  upsertScoredTask,
} from "../pipeline/store.js";
import { DEFAULT_PIPELINE_CONFIG, type PipelineTask } from "../pipeline/types.js";

const SONNET = { costPer1kInput: 20, costPer1kOutput: 100 };
const NO_RECORD = { wins: 0, losses: 0 };

function task(overrides: Partial<PipelineTask> = {}): PipelineTask {
  return {
    platform: "taskmarket",
    id: "TSK-1",
    title: "Fix failing unit tests",
    description: "x".repeat(1000),
    rewardUsd: 50,
    platformFee: 0,
    exclusive: true,
    ...overrides,
  };
}

let db: BetterSqlite3.Database;
beforeEach(() => {
  db = new Database(":memory:");
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
});

describe("classifyByRules", () => {
  const cases: Array<[string, string]> = [
    ["Fix the bug in the TypeScript SDK and add a regression test to the repo", "coding"],
    ["Clean this CSV dataset: dedup rows, normalize dates and export JSON", "data"],
    ["Research competitors and compile a list with sources and citations", "research"],
    ["Automate the webhook integration with a cron pipeline and GitHub Actions", "automation"],
    ["Quest: write a blog post and a short tutorial guide for our docs", "content"],
    ["Design a scalable logo system and brand illustration", "other"],
  ];
  it.each(cases)("%s -> %s", (text, expected) => {
    expect(classifyByRules(text).category).toBe(expected);
  });

  it("is not confident on vague text", () => {
    const result = classifyByRules("Help me with something interesting");
    expect(result.category).toBe("other");
    expect(isConfident(result)).toBe(false);
  });

  it("is confident on a clear multi-signal task", () => {
    expect(isConfident(classifyByRules(cases[0][0]))).toBe(true);
  });
});

describe("scoreTask", () => {
  it("computes expected profit = p × net reward − model cost − time cost", () => {
    const s = scoreTask({
      task: task({ rewardUsd: 100, platformFee: 0.2 }),
      category: "data",
      classifiedBy: "rules",
      config: DEFAULT_PIPELINE_CONFIG,
      price: SONNET,
      record: NO_RECORD,
    });
    // data profile: 200k in / 25k out, 0.75 h, base 55%; complexity 1 (1000 chars)
    const modelCost = 200 * 0.002 * (1 - 0.6) + 25 * 0.01; // 0.16 + 0.25
    const timeCost = 0.75 * 0.25;
    expect(s.netReward).toBeCloseTo(80);
    expect(s.modelCost).toBeCloseTo(modelCost);
    expect(s.timeCost).toBeCloseTo(timeCost);
    expect(s.successProbability).toBeCloseTo(0.55);
    expect(s.expectedProfit).toBeCloseTo(0.55 * 80 - modelCost - timeCost);
    expect(s.rejectReason).toBeUndefined();
  });

  it("rejects out-of-scope work without spending anything", () => {
    const s = scoreTask({
      task: task(), category: "other", classifiedBy: "rules",
      config: DEFAULT_PIPELINE_CONFIG, price: SONNET, record: NO_RECORD,
    });
    expect(s.expectedProfit).toBe(0);
    expect(s.rejectReason).toMatch(/especialidades/);
  });

  it("rejects tasks below the minimum expected profit", () => {
    const s = scoreTask({
      task: task({ rewardUsd: 2 }), category: "content", classifiedBy: "rules",
      config: DEFAULT_PIPELINE_CONFIG, price: SONNET, record: NO_RECORD,
    });
    expect(s.rejectReason).toMatch(/mínimo \$2\.00/);
  });

  it("penalizes deadlines shorter than twice the estimated time", () => {
    const now = new Date("2026-10-05T00:00:00Z");
    const s = scoreTask({
      task: task({ expiresAt: "2026-10-05T01:00:00Z" }), category: "coding", classifiedBy: "rules",
      config: DEFAULT_PIPELINE_CONFIG, price: SONNET, record: NO_RECORD, now,
    });
    expect(s.rejectReason).toMatch(/^vence en 1\.0 h/);
    expect(s.successProbability).toBeCloseTo(0.035);
  });

  it("formats a readable breakdown", () => {
    const s = scoreTask({
      task: task(), category: "research", classifiedBy: "rules",
      config: DEFAULT_PIPELINE_CONFIG, price: SONNET, record: NO_RECORD,
    });
    expect(formatBreakdown(s)).toMatch(/^EP \$\d+\.\d{2} = 50% × \$50\.00 neto − IA \$/);
  });
});

describe("score components", () => {
  it("competition: exclusive claims win, crowded bounties lose", () => {
    expect(competitionFactor(task({ exclusive: true }))).toBe(1);
    expect(competitionFactor(task({ exclusive: false }))).toBeCloseTo(0.7);
    expect(competitionFactor(task({ exclusive: false, competitors: 4 }))).toBeCloseTo(0.7 / 3);
    expect(competitionFactor(task({ exclusive: false, mode: "pitch" }))).toBeCloseTo(0.4);
  });

  it("complexity grows with hard signals and shrinks with easy ones", () => {
    expect(estimateComplexity(task({ description: "x".repeat(1000) }))).toBe(1);
    expect(estimateComplexity(task({ description: "Hard task, several focused days, end-to-end" + "x".repeat(1000) }))).toBe(2.5);
    expect(
      estimateComplexity(task({ description: "Hard, multi-day, full stack, production audit from scratch" + "x".repeat(4000) })),
    ).toBe(3); // clamped
    expect(estimateComplexity(task({ title: "Quick small typo fix", description: "short" }))).toBeCloseTo(0.5);
  });

  it("calibration moves the prior toward our real record", () => {
    expect(calibratedSuccess(0.5, NO_RECORD)).toBe(0.5);
    expect(calibratedSuccess(0.5, { wins: 6, losses: 0 })).toBeCloseTo(0.8);
    expect(calibratedSuccess(0.5, { wins: 0, losses: 6 })).toBeCloseTo(0.2);
  });
});

describe("store", () => {
  it("cache honours TTL", () => {
    cacheSet(db, "k", { a: 1 }, 60_000);
    expect(cacheGet(db, "k")).toEqual({ a: 1 });
    cacheSet(db, "old", 1, -1);
    expect(cacheGet(db, "old")).toBeUndefined();
  });

  it("outcomes feed the category record and leave the queue", () => {
    const t = task();
    const s = scoreTask({
      task: t, category: "coding", classifiedBy: "rules",
      config: DEFAULT_PIPELINE_CONFIG, price: SONNET, record: NO_RECORD,
    });
    upsertScoredTask(db, t, { ...s, expectedProfit: 10 });
    expect(listQueue(db, 2)).toHaveLength(1);

    expect(recordOutcome(db, "taskmarket", "TSK-1", "won", 120)).toBe(true);
    expect(getCategoryRecord(db, "coding")).toEqual({ wins: 1, losses: 0 });
    expect(listQueue(db, 2)).toHaveLength(0);
    expect(recordOutcome(db, "taskmarket", "missing", "won")).toBe(false);
  });

  it("re-scoring keeps an existing outcome", () => {
    const t = task();
    const s = scoreTask({
      task: t, category: "coding", classifiedBy: "rules",
      config: DEFAULT_PIPELINE_CONFIG, price: SONNET, record: NO_RECORD,
    });
    upsertScoredTask(db, t, s);
    recordOutcome(db, "taskmarket", "TSK-1", "lost");
    upsertScoredTask(db, t, s);
    expect(getCategoryRecord(db, "coding")).toEqual({ wins: 0, losses: 1 });
  });
});

describe("classifyWithLlm", () => {
  const models = DEFAULT_PIPELINE_CONFIG.cheapModels;
  const keys = { ollamaBaseUrl: "http://ollama:11434", anthropicApiKey: "test-key" };

  it("falls back to the next model and caches the answer", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url.includes("ollama")) throw new Error("connection refused");
      return {
        ok: true,
        json: async () => ({ content: [{ type: "text", text: '{"category": "research"}' }] }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);

    const first = await classifyWithLlm(db, "some task", models, keys);
    expect(first).toEqual({ category: "research", source: "llm", model: "claude-haiku-4-5-20251001" });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const second = await classifyWithLlm(db, "some task", models, keys);
    expect(second).toEqual({ category: "research", source: "cache" });
    expect(fetchMock).toHaveBeenCalledTimes(2); // served from cache
  });

  it("classifies with Gemini through its OpenAI-compatible endpoint", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: any) => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '{"category": "data"}' } }] }),
    }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const gemini = models.filter((m) => m.provider === "gemini");
    const result = await classifyWithLlm(db, "clean csv", gemini, { geminiApiKey: "gem-key" });
    expect(result).toEqual({ category: "data", source: "llm", model: "gemini-3.5-flash-lite" });
    expect(fetchMock.mock.calls[0][0]).toContain("generativelanguage.googleapis.com/v1beta/openai");
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer gem-key");
  });

  it("returns undefined when every model fails or answers garbage", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ message: { content: "no json" } }) }) as Response));
    expect(await classifyWithLlm(db, "x", [models[0]], keys)).toBeUndefined();
  });
});

describe("evaluateTasks", () => {
  it("ranks by expected profit and only keeps worthwhile tasks", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    const tasks = [
      task({ id: "big", title: "Clean CSV dataset, dedup and normalize to JSON schema", rewardUsd: 60 }),
      task({ id: "logo", title: "Design a logo illustration", rewardUsd: 500 }),
      task({ id: "tiny", title: "Write a blog post article for our docs", rewardUsd: 1 }),
    ];
    const scored = await evaluateTasks(db, tasks, DEFAULT_PIPELINE_CONFIG, {});
    expect(scored[0].task.id).toBe("big");
    expect(scored.filter((s) => isWorthIt(s, DEFAULT_PIPELINE_CONFIG)).map((s) => s.task.id)).toEqual(["big"]);
    expect(scored.find((s) => s.task.id === "logo")!.score.category).toBe("other");
  });
});
