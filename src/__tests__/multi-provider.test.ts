/**
 * Multi-provider routing (configured-model preference, cross-provider
 * fallback) and Anthropic prompt-cache breakpoints.
 */

import Database from "better-sqlite3";
import type BetterSqlite3 from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_CHAT_COMPLETIONS_URL,
  PROMPT_CACHE_MARKER,
  buildAnthropicSystem,
  createInferenceClient,
  withConversationBreakpoint,
} from "../conway/inference.js";
import { InferenceBudgetTracker } from "../inference/budget.js";
import { ModelRegistry } from "../inference/registry.js";
import { InferenceRouter } from "../inference/router.js";
import { DEFAULT_MODEL_STRATEGY_CONFIG } from "../inference/types.js";
import { MIGRATION_V6 } from "../state/schema.js";
import type { ModelStrategyConfig } from "../types.js";

let db: BetterSqlite3.Database;

function makeRouter(overrides: Partial<ModelStrategyConfig>) {
  const registry = new ModelRegistry(db);
  registry.initialize();
  const config = { ...DEFAULT_MODEL_STRATEGY_CONFIG, ...overrides };
  return new InferenceRouter(db, registry, new InferenceBudgetTracker(db, config));
}

const request = {
  messages: [{ role: "user" as const, content: "hi" }],
  taskType: "agent_turn" as const,
  tier: "normal" as const,
  sessionId: "s1",
};

const okResponse = {
  message: { content: "ok" },
  usage: { promptTokens: 1000, completionTokens: 100 },
  finishReason: "stop",
};

beforeEach(() => {
  db = new Database(":memory:");
  db.exec(MIGRATION_V6);
});
afterEach(() => db.close());

describe("InferenceRouter provider selection", () => {
  it("uses the routing matrix by default", () => {
    const router = makeRouter({ inferenceModel: "claude-sonnet-5-5" });
    expect(router.selectModel("normal", "agent_turn")?.modelId).toBe("gpt-5.2");
  });

  it("prefers the configured model when asked to", () => {
    const router = makeRouter({ inferenceModel: "claude-sonnet-5-5", preferConfiguredModels: true });
    expect(router.selectModel("normal", "agent_turn")?.modelId).toBe("claude-sonnet-5-5");
  });

  it("falls back to the next provider when the first one errors", async () => {
    const router = makeRouter({
      inferenceModel: "claude-sonnet-5-5",
      preferConfiguredModels: true,
      fallbackModels: ["gpt-5.2", "claude-haiku-4-5-20251001"],
    });
    const chat = vi.fn(async (_messages: any[], opts: any) => {
      if (opts.model !== "claude-haiku-4-5-20251001") throw new Error(`${opts.model} down`);
      return okResponse;
    });

    const result = await router.route(request, chat);
    expect(chat.mock.calls.map((c) => c[1].model)).toEqual([
      "claude-sonnet-5-5",
      "gpt-5.2",
      "claude-haiku-4-5-20251001",
    ]);
    expect(result.model).toBe("claude-haiku-4-5-20251001");
    expect(result.provider).toBe("anthropic");
  });

  it("skips disabled fallbacks and rethrows when every provider fails", async () => {
    const router = makeRouter({
      inferenceModel: "claude-sonnet-5-5",
      preferConfiguredModels: true,
      fallbackModels: ["gpt-5.2"],
    });
    new ModelRegistry(db).setEnabled("gpt-5.2", false); // e.g. no OpenAI key
    const chat = vi.fn(async () => { throw new Error("anthropic down"); });
    await expect(router.route(request, chat)).rejects.toThrow("anthropic down");
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("does not fall back when fallback is disabled", async () => {
    const router = makeRouter({ fallbackModels: ["gpt-5.3"], enableModelFallback: false });
    const chat = vi.fn(async () => { throw new Error("down"); });
    await expect(router.route(request, chat)).rejects.toThrow("down");
    expect(chat).toHaveBeenCalledTimes(1);
  });
});

describe("Gemini backend", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("routes gemini models to the OpenAI-compatible endpoint and counts hidden thinking tokens", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: any) => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "hola" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 49, completion_tokens: 17, total_tokens: 120 },
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createInferenceClient({
      apiUrl: "https://api.conway.tech",
      apiKey: "",
      defaultModel: "gemini-3.8-flash",
      maxTokens: 1000,
      geminiApiKey: "gem-key",
    });
    const res = await client.chat([{ role: "user", content: "hi" }], { model: "gemini-3.8-flash" });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(GEMINI_CHAT_COMPLETIONS_URL);
    expect(new Headers(init.headers).get("Authorization")).toBe("Bearer gem-key");
    expect(res.message.content).toBe("hola");
    expect(res.usage.completionTokens).toBe(71); // 120 total − 49 prompt
  });

  it("does not route to gemini without a key", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { role: "assistant", content: "x" }, finish_reason: "stop" }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const client = createInferenceClient({
      apiUrl: "https://api.conway.tech", apiKey: "k", defaultModel: "gemini-3.8-flash", maxTokens: 100,
    });
    await client.chat([{ role: "user", content: "hi" }], { model: "gemini-3.8-flash" });
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.conway.tech/v1/chat/completions");
  });
});

describe("Anthropic prompt caching", () => {
  it("splits the system prompt at the marker and caches the stable part", () => {
    const blocks = buildAnthropicSystem(`rules\ngenesis\n\n${PROMPT_CACHE_MARKER}\n\nstatus: turn 7`) as any[];
    expect(blocks).toEqual([
      { type: "text", text: "rules\ngenesis", cache_control: { type: "ephemeral" } },
      { type: "text", text: "status: turn 7" },
    ]);
  });

  it("leaves a marker-less system prompt untouched", () => {
    expect(buildAnthropicSystem("plain")).toBe("plain");
  });

  it("adds a breakpoint to the newest message", () => {
    const out = withConversationBreakpoint([
      { role: "user", content: "first" },
      { role: "assistant", content: [{ type: "text", text: "ok" }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "result" }] },
    ]) as any[];
    expect(out[0].content).toBe("first");
    expect(out[2].content[0]).toEqual({
      type: "tool_result", tool_use_id: "t1", content: "result", cache_control: { type: "ephemeral" },
    });
  });

  it("converts a string message into a cacheable text block", () => {
    const out = withConversationBreakpoint([{ role: "user", content: "hello" }]) as any[];
    expect(out[0].content).toEqual([{ type: "text", text: "hello", cache_control: { type: "ephemeral" } }]);
  });
});
