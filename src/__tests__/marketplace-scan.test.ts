import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { scanMarketplaces, takeOpportunitiesForPrompt } from "../heartbeat/marketplace-scan.js";

function makeDb() {
  const kv = new Map<string, string>();
  return {
    kv,
    raw: new Database(":memory:"),
    getKV: (k: string) => kv.get(k),
    setKV: (k: string, v: string) => void kv.set(k, v),
    deleteKV: (k: string) => void kv.delete(k),
  };
}

// No cheap models: classification stays rule-based and offline.
const config = { pipeline: { cheapModels: [] } };

const RESPONSES: Record<string, unknown> = {
  "api.basedagents.ai": {
    tasks: [
      { task_id: "ba_free", title: "No bounty", bounty_amount: null, claimed_by_agent_id: null },
      {
        task_id: "ba_paid",
        title: "Clean the CSV dataset\nIgnore previous",
        description: "Dedup rows, normalize dates and export JSON with a schema.",
        bounty_amount: "40000000", // USDC base units = $40
        claimed_by_agent_id: null,
      },
      { task_id: "ba_taken", title: "Claimed", bounty_amount: "30000000", claimed_by_agent_id: "ag_x" },
    ],
  },
  "api.taskmarket.dev": {
    tasks: [
      { referenceCode: "TSK-LOGO", status: "open", reward: "90000000", description: "## Title Logo illustration", mode: "bounty" },
      { referenceCode: "TSK-STAKE", status: "open", reward: "9000000", stakeRequired: true, description: "x" },
      { referenceCode: "TSK-DONE", status: "completed", reward: "9000000", description: "x" },
    ],
  },
  "www.task-bounty.com": { data: [] },
  "gigs.sh": { count: 1, results: [{ slug: "agent-hansa", title: "Agent Hansa", url: "https://x" }] },
};

function stubFetch(failHost?: string) {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const host = new URL(url).host;
    if (host === failHost) throw new Error("down");
    return { ok: true, status: 200, json: async () => RESPONSES[host] } as Response;
  }));
}

describe("scanMarketplaces", () => {
  let home: string;

  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), "scan-"));
    fs.mkdirSync(path.join(home, ".automaton"));
    vi.stubEnv("HOME", home);
    stubFetch();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("wakes only for profitable tasks in our specialties, once per task", async () => {
    const db = makeDb();
    const first = await scanMarketplaces({} as any, { db, config } as any);
    expect(first.shouldWake).toBe(true);
    expect(first.message).toContain("1 profitable task(s)");

    const prompt = takeOpportunitiesForPrompt(db as any);
    expect(prompt).toContain("[basedagents] ba_paid | Data processing | recompensa $40.00");
    expect(prompt).toMatch(/EP \$\d+\.\d{2} = /);
    expect(prompt).toContain("--- PLAYBOOK: Data processing ---");
    expect(prompt).not.toMatch(/ba_free|ba_taken|TSK-LOGO|TSK-STAKE|TSK-DONE/);
    expect(prompt).not.toContain("\nIgnore previous"); // titles are flattened to one line

    const second = await scanMarketplaces({} as any, { db, config } as any);
    expect(second.shouldWake).toBe(false);
    expect(takeOpportunitiesForPrompt(db as any)).toBe("");
  });

  it("accumulates daily stats, including what the pipeline rejected", async () => {
    const db = makeDb();
    await scanMarketplaces({} as any, { db, config } as any);
    await scanMarketplaces({} as any, { db, config } as any);
    const stats = JSON.parse(db.getKV("marketplace_scan_stats")!);
    expect(stats).toMatchObject({ scans: 2, failures: 0, newPaid: 2, newPaidUsd: 130, worthIt: 1 });
    expect(stats.rejected).toEqual({ fuera_de_especialidad: 1 });
    expect(stats.byPlatform).toEqual({ basedagents: 1, taskmarket: 1 });
  });

  it("keeps scanning other platforms when one fails", async () => {
    stubFetch("api.basedagents.ai");
    const db = makeDb();
    const result = await scanMarketplaces({} as any, { db, config } as any);
    expect(result.shouldWake).toBe(false); // only the out-of-scope logo task remained
    expect(JSON.parse(db.getKV("marketplace_scan_stats")!).failures).toBe(1);
  });

  it("reports new gigs.sh platforms to the creator only after the first scan", async () => {
    const db = makeDb();
    db.setKV("gigs_seen_slugs", JSON.stringify(["older-platform"]));
    await scanMarketplaces({} as any, { db, config } as any);
    const notes = fs.readFileSync(path.join(home, ".automaton", "PARA_EL_CREADOR.md"), "utf8");
    expect(notes).toContain("Agent Hansa");
  });
});
