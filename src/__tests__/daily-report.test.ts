import { describe, expect, it } from "vitest";
import { buildDailyReport } from "../heartbeat/daily-report.js";
import { emptyScanStats } from "../heartbeat/marketplace-scan.js";

const base = {
  spend24h: [],
  spendMonthCents: 0,
  turns24h: 0,
  dailyCapCents: 500,
  agentState: "sleeping",
  scan: emptyScanStats(),
  creatorUsdc: null,
  previousCreatorUsdc: null,
};

describe("buildDailyReport", () => {
  it("summarizes spend per model against the daily cap", () => {
    const report = buildDailyReport({
      ...base,
      spend24h: [
        { model: "claude-sonnet-5-5", calls: 12, inputTokens: 150000, outputTokens: 9000, costCents: 40 },
        { model: "claude-haiku-4-5-20251001", calls: 3, inputTokens: 20000, outputTokens: 1000, costCents: 3 },
      ],
      spendMonthCents: 210,
      turns24h: 15,
    });
    expect(report).toContain("Gasto en IA: $0.43 de un tope diario de $5.00");
    expect(report).toContain("mes en curso: $2.10");
    expect(report).toContain("claude-sonnet-5-5: 12 llamadas");
    expect(report).toContain("15 turnos · estado actual: sleeping");
  });

  it("reports scanner totals by platform", () => {
    const report = buildDailyReport({
      ...base,
      scan: { scans: 72, failures: 1, newPaid: 3, newPaidUsd: 185.5, byPlatform: { taskmarket: 3 } },
    });
    expect(report).toContain("72 revisiones (1 fallos de API) · 3 tareas pagadas nuevas por ~$185.50 (taskmarket: 3)");
  });

  it("shows the creator wallet balance change since the previous report", () => {
    const report = buildDailyReport({ ...base, creatorUsdc: 27.5, previousCreatorUsdc: 25 });
    expect(report).toContain("Saldo USDC en Base de tu wallet: $27.50 (+2.50 vs. informe anterior)");
  });

  it("degrades gracefully when there was no activity and the balance lookup failed", () => {
    const report = buildDailyReport(base);
    expect(report).toContain("Sin llamadas al modelo.");
    expect(report).toContain("No se pudo consultar el saldo USDC");
  });
});
