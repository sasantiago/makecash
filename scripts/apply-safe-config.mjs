#!/usr/bin/env node
/**
 * Aplica una configuración conservadora sobre ~/.automaton/automaton.json
 * (ejecutar DESPUÉS del setup wizard). Idempotente.
 *
 *   docker compose run --rm --entrypoint node automaton scripts/apply-safe-config.mjs
 */
import fs from "fs";
import path from "path";

const configPath = path.join(process.env.HOME || "/root", ".automaton", "automaton.json");
if (!fs.existsSync(configPath)) {
  console.error(`No existe ${configPath}. Ejecuta primero el setup wizard.`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

if (!config.anthropicApiKey) {
  console.warn("Aviso: no hay anthropicApiKey en la config; los modelos claude-* caerán a Conway.");
}

const MAIN_MODEL = "claude-sonnet-5-5";
const CHEAP_MODEL = "claude-haiku-4-5-20251001";

config.inferenceModel = MAIN_MODEL;
config.maxTokensPerTurn = 4096;
config.maxChildren = 2;
config.maxTurnsPerCycle = 15;
config.childSandboxMemoryMb = 1024;
config.logLevel = "info";

config.modelStrategy = {
  ...(config.modelStrategy ?? {}),
  inferenceModel: MAIN_MODEL,
  lowComputeModel: CHEAP_MODEL,
  criticalModel: CHEAP_MODEL,
  maxTokensPerTurn: 4096,
  hourlyBudgetCents: 100,   // $1/hora
  sessionBudgetCents: 0,
  perCallCeilingCents: 25,  // $0.25 por llamada
  enableModelFallback: true,
};

config.treasuryPolicy = {
  ...(config.treasuryPolicy ?? {}),
  maxSingleTransferCents: 500,        // $5 por transferencia
  maxHourlyTransferCents: 1000,       // $10/hora
  maxDailyTransferCents: 1000,        // $10/día
  minimumReserveCents: 500,           // deja siempre $5 de reserva
  maxX402PaymentCents: 50,            // $0.50 por pago x402
  x402AllowedDomains: ["conway.tech"],
  transferCooldownMs: 60_000,         // 1 min entre transferencias
  maxTransfersPerTurn: 1,
  maxInferenceDailyCents: 500,        // $5/día de inferencia
  requireConfirmationAboveCents: 200, // confirmar sobre $2
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2), { mode: 0o600 });
console.log("Configuración conservadora aplicada:");
console.log(`  modelo principal: ${MAIN_MODEL} | bajo/crítico: ${CHEAP_MODEL}`);
console.log("  hijos máx: 2 | inferencia máx: $5/día, $1/hora | transferencias máx: $10/día");
