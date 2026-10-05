/**
 * Regression: tool-only turns (no visible text, as Claude Sonnet 5.5 often
 * produces) must stay in the conversation history with their results, and
 * survive the Anthropic message transform as tool_use → tool_result pairs.
 */

import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { buildContextMessages } from "../agent/context.js";
import { InferenceBudgetTracker } from "../inference/budget.js";
import { ModelRegistry } from "../inference/registry.js";
import { InferenceRouter } from "../inference/router.js";
import { DEFAULT_MODEL_STRATEGY_CONFIG } from "../inference/types.js";
import { MIGRATION_V6 } from "../state/schema.js";
import type { AgentTurn } from "../types.js";

const toolOnlyTurn: AgentTurn = {
  id: "t1",
  timestamp: "2026-10-05T03:43:51.000Z",
  state: "running",
  input: "Check the queue",
  inputSource: "system",
  thinking: "",
  toolCalls: [
    { id: "toolu_1", name: "exec", arguments: { command: "makecash queue" }, result: "Sin tareas", durationMs: 5 },
  ],
  tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
  costCents: 0,
} as AgentTurn;

describe("conversation history", () => {
  it("keeps tool-only turns and their results", () => {
    const messages = buildContextMessages("system", [toolOnlyTurn]);
    const assistant = messages.find((m) => m.role === "assistant");
    expect(assistant?.tool_calls?.[0].id).toBe("toolu_1");
    const tool = messages.find((m) => m.role === "tool");
    expect(tool).toMatchObject({ tool_call_id: "toolu_1" });
    expect(tool?.content).toContain("Sin tareas");
  });

  it("routes the history to Anthropic with tool results right after the tool call", () => {
    const db = new Database(":memory:");
    db.exec(MIGRATION_V6);
    const registry = new ModelRegistry(db);
    registry.initialize();
    const router = new InferenceRouter(db, registry, new InferenceBudgetTracker(db, DEFAULT_MODEL_STRATEGY_CONFIG));

    const messages = buildContextMessages("system", [toolOnlyTurn], { content: "next", source: "system" });
    const routed = router.transformMessagesForProvider(messages, "anthropic");
    const callIndex = routed.findIndex((m) => m.tool_calls?.length);
    expect(routed[callIndex + 1]).toMatchObject({ role: "tool", tool_call_id: "toolu_1" });
    db.close();
  });
});
