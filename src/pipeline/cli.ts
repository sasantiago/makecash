#!/usr/bin/env node
/**
 * makecash — deterministic helpers the agent calls through `exec`.
 *
 *   makecash queue                         ranked profitable tasks
 *   makecash outcome <platform> <id> <taken|won|lost|abandoned|skipped> [--cost-cents N]
 *   makecash playbook <category>           working steps for a specialty
 *   makecash stats                         success record and calibration per category
 *   makecash fetch <url> [--ttl seconds]   cached HTTP GET (default 10 min)
 */

import path from "path";
import Database from "better-sqlite3";
import { loadConfig, resolvePath } from "../config.js";
import { loadPlaybook } from "./evaluate.js";
import { calibratedSuccess, formatBreakdown } from "./score.js";
import {
  OUTCOMES,
  cacheGet,
  cacheSet,
  getCategoryRecord,
  hashKey,
  listQueue,
  recordOutcome,
  type Outcome,
} from "./store.js";
import { CATEGORIES, CATEGORY_LABELS, resolvePipelineConfig, type Category } from "./types.js";

const MAX_FETCH_BYTES = 200_000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

function flag(args: string[], name: string): string | undefined {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function openDb(): { db: Database.Database; pipeline: ReturnType<typeof resolvePipelineConfig> } {
  const config = loadConfig();
  const dbPath = resolvePath(config?.dbPath ?? "~/.automaton/state.db");
  return {
    db: new Database(path.resolve(dbPath)),
    pipeline: resolvePipelineConfig(config?.pipeline),
  };
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;

  switch (command) {
    case "queue": {
      const { db, pipeline } = openDb();
      const rows = listQueue(db, pipeline.minExpectedProfitUsd);
      if (rows.length === 0) {
        console.log(`Sin tareas con ganancia esperada >= $${pipeline.minExpectedProfitUsd}. Duerme.`);
        return;
      }
      rows.forEach((r, i) => {
        console.log(
          `${i + 1}. [${r.platform}] ${r.task_id} (${r.status}) | ${CATEGORY_LABELS[r.category]} | $${r.reward_usd.toFixed(2)}\n` +
            `   ${r.title}\n   ${formatBreakdown(JSON.parse(r.breakdown))}`,
        );
      });
      return;
    }

    case "outcome": {
      const [platform, id, outcome] = args;
      if (!platform || !id || !OUTCOMES.includes(outcome as Outcome)) {
        fail(`uso: makecash outcome <plataforma> <id> <${OUTCOMES.join("|")}> [--cost-cents N]`);
      }
      const costArg = flag(args, "--cost-cents");
      const cost = costArg === undefined ? undefined : Number(costArg);
      if (cost !== undefined && !Number.isFinite(cost)) fail("--cost-cents debe ser un número");
      const { db } = openDb();
      if (!recordOutcome(db, platform, id, outcome as Outcome, cost)) {
        fail(`No hay una tarea ${platform}/${id} en el historial del pipeline.`);
      }
      console.log(`Registrado: ${platform}/${id} -> ${outcome}`);
      return;
    }

    case "playbook": {
      const category = args[0] as Category;
      if (!CATEGORIES.includes(category)) fail(`categorías: ${CATEGORIES.join(", ")}`);
      console.log(loadPlaybook(category));
      return;
    }

    case "stats": {
      const { db, pipeline } = openDb();
      for (const category of CATEGORIES) {
        const record = getCategoryRecord(db, category);
        const p = calibratedSuccess(pipeline.profiles[category].baseSuccess, record);
        console.log(
          `${CATEGORY_LABELS[category].padEnd(28)} ganadas ${record.wins} · perdidas ${record.losses} · ` +
            `probabilidad calibrada ${(p * 100).toFixed(0)}%`,
        );
      }
      return;
    }

    case "fetch": {
      const url = args[0];
      if (!url || !/^https:\/\//.test(url)) fail("uso: makecash fetch <https-url> [--ttl segundos]");
      const ttlSeconds = Number(flag(args, "--ttl") ?? 600);
      const { db } = openDb();
      const key = hashKey("fetch:v1", url);
      const cached = cacheGet<string>(db, key);
      if (cached !== undefined) {
        process.stdout.write(cached);
        return;
      }
      const resp = await fetch(url, { signal: AbortSignal.timeout(20_000) });
      const body = (await resp.text()).slice(0, MAX_FETCH_BYTES);
      if (!resp.ok) fail(`HTTP ${resp.status}: ${body.slice(0, 300)}`);
      cacheSet(db, key, body, ttlSeconds * 1000);
      process.stdout.write(body);
      return;
    }

    default:
      console.log(
        [
          "makecash queue",
          `makecash outcome <plataforma> <id> <${OUTCOMES.join("|")}> [--cost-cents N]`,
          `makecash playbook <${CATEGORIES.join("|")}>`,
          "makecash stats",
          "makecash fetch <https-url> [--ttl segundos]",
        ].join("\n"),
      );
  }
}

main(process.argv.slice(2)).catch((err) => fail(err?.message ?? String(err)));
