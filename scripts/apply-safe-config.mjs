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
  // Usa siempre los modelos de arriba antes que la matriz de Conway (GPT).
  preferConfiguredModels: true,
  // Si el proveedor principal falla, prueba estos en orden. Los que no
  // tengan key configurada se ignoran solos.
  fallbackModels: ["gemini-3.8-flash", "gpt-5.2", CHEAP_MODEL],
};

// Pipeline determinista: clasificación, puntuación y modelos baratos.
config.pipeline = {
  ...(config.pipeline ?? {}),
  minExpectedProfitUsd: 2,
  hourlyRateUsd: 0.25,
  workModel: MAIN_MODEL,
  promptCacheSavings: 0.6,
  ollamaBaseUrl: "http://host.docker.internal:11434",
  cheapModels: [
    { model: "llama3.2:3b", provider: "ollama" },
    { model: "gemini-3.5-flash-lite", provider: "gemini" },
    { model: CHEAP_MODEL, provider: "anthropic" },
    { model: "gpt-5-mini", provider: "openai" },
  ],
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
console.log("  respaldo: Gemini 3.8 Flash -> gpt-5.2 (si hay key) -> Haiku | pipeline: EP mínima $2, Ollama -> Gemini Flash-Lite para clasificar");
