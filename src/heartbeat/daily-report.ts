/**
 * Daily Report
 *
 * Deterministic (no inference) heartbeat task that appends a once-a-day
 * summary to the creator's notes file: real inference spend from the
 * inference_costs table, agent activity, marketplace scan totals and the
 * creator wallet's USDC balance on Base (where platform payouts land).
 */

import type { TickContext, HeartbeatLegacyContext } from "../types.js";
import { getUsdcBalance } from "../conway/x402.js";
import { createLogger } from "../observability/logger.js";
import {
  SCAN_STATS_KV,
  appendCreatorNote,
  emptyScanStats,
  readJsonKV,
  type ScanStats,
} from "./marketplace-scan.js";

const logger = createLogger("heartbeat.daily-report");

const LAST_CREATOR_USDC_KV = "daily_report_creator_usdc";

interface SpendRow {
  model: string;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  costCents: number;
}

function usd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function buildDailyReport(params: {
  spend24h: SpendRow[];
  spendMonthCents: number;
  turns24h: number;
  dailyCapCents: number;
  agentState: string;
  scan: ScanStats;
  creatorUsdc: number | null;
  previousCreatorUsdc: number | null;
}): string {
  const { spend24h, spendMonthCents, turns24h, dailyCapCents, agentState, scan } = params;
  const total24h = spend24h.reduce((sum, r) => sum + r.costCents, 0);

  const spendLines = spend24h.length
    ? spend24h.map(
        (r) =>
          `  - ${r.model}: ${r.calls} llamadas, ${r.inputTokens.toLocaleString("es")} tokens entrada / ` +
          `${r.outputTokens.toLocaleString("es")} salida, ${usd(r.costCents)}`,
      )
    : ["  - Sin llamadas al modelo."];

  const platforms = Object.entries(scan.byPlatform)
    .map(([name, count]) => `${name}: ${count}`)
    .join(", ");
  const rejected = Object.entries(scan.rejected ?? {})
    .map(([reason, count]) => `${reason.replace(/_/g, " ")}: ${count}`)
    .join(", ");

  let wallet = "  - No se pudo consultar el saldo USDC de tu wallet.";
  if (params.creatorUsdc !== null) {
    const delta =
      params.previousCreatorUsdc === null
        ? ""
        : ` (${params.creatorUsdc - params.previousCreatorUsdc >= 0 ? "+" : ""}` +
          `${(params.creatorUsdc - params.previousCreatorUsdc).toFixed(2)} vs. informe anterior)`;
    wallet = `  - Saldo USDC en Base de tu wallet: $${params.creatorUsdc.toFixed(2)}${delta}`;
  }

  return [
    `**Informe diario (últimas 24 h)**`,
    `- Gasto en IA: ${usd(total24h)} de un tope diario de ${usd(dailyCapCents)} · mes en curso: ${usd(spendMonthCents)} (estimado por el agente; el dato exacto está en console.anthropic.com)`,
    ...spendLines,
    `- Actividad del agente: ${turns24h} turnos · estado actual: ${agentState}`,
    `- Escáner: ${scan.scans} revisiones (${scan.failures} fallos de API) · ${scan.newPaid} tareas pagadas nuevas por ~$${scan.newPaidUsd.toFixed(2)}${platforms ? ` (${platforms})` : ""}`,
    `- Pipeline: ${scan.worthIt ?? 0} rentables enviadas al agente${rejected ? ` · descartadas sin usar IA cara: ${rejected}` : ""}`,
    `- Cobros:`,
    wallet,
  ].join("\n");
}

export async function dailyReport(
  _ctx: TickContext,
  taskCtx: HeartbeatLegacyContext,
): Promise<{ shouldWake: boolean; message?: string }> {
  const { db, config } = taskCtx;
  const raw = db.raw;

  const spend24h = raw
    .prepare(
      `SELECT model, COUNT(*) AS calls, SUM(input_tokens) AS inputTokens,
              SUM(output_tokens) AS outputTokens, SUM(cost_cents) AS costCents
       FROM inference_costs WHERE created_at >= datetime('now', '-1 day')
       GROUP BY model ORDER BY costCents DESC`,
    )
    .all() as SpendRow[];

  const { cents: spendMonthCents } = raw
    .prepare(
      `SELECT COALESCE(SUM(cost_cents), 0) AS cents FROM inference_costs
       WHERE created_at >= datetime('now', 'start of month')`,
    )
    .get() as { cents: number };

  const { n: turns24h } = raw
    .prepare(`SELECT COUNT(*) AS n FROM turns WHERE created_at >= datetime('now', '-1 day')`)
    .get() as { n: number };

  let creatorUsdc: number | null = null;
  if (config.creatorAddress && (config.chainType ?? "evm") === "evm") {
    try {
      creatorUsdc = await getUsdcBalance(config.creatorAddress, "eip155:8453");
    } catch (err: any) {
      logger.warn(`Creator USDC balance lookup failed: ${err.message}`);
    }
  }
  const previous = db.getKV(LAST_CREATOR_USDC_KV);

  const report = buildDailyReport({
    spend24h,
    spendMonthCents,
    turns24h,
    dailyCapCents: config.treasuryPolicy?.maxInferenceDailyCents ?? 0,
    agentState: db.getAgentState(),
    scan: readJsonKV<ScanStats>(db, SCAN_STATS_KV, emptyScanStats()),
    creatorUsdc,
    previousCreatorUsdc: previous === undefined ? null : Number(previous),
  });

  appendCreatorNote(report, "informe diario");
  db.setKV(SCAN_STATS_KV, JSON.stringify(emptyScanStats()));
  if (creatorUsdc !== null) db.setKV(LAST_CREATOR_USDC_KV, String(creatorUsdc));

  return { shouldWake: false };
}
