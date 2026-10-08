import assert from "node:assert/strict";
import test from "node:test";
import { deriveTaskObservability } from "../lib/task-observability.ts";

test("bloqueio expõe causa, tentativas e ação de retomada", () => {
  const result = deriveTaskObservability({
    task: { status: "blocked", current_step: 1, blocked_reason: "Recuperação esgotada." },
    steps: [{
      step_number: 1,
      status: "failed",
      attempt_count: 3,
      last_error: { message: "Adapter indisponível." },
    }],
    isStale: false,
  });

  assert.equal(result.attention?.kind, "blocked");
  assert.equal(result.attention?.action, "resume");
  assert.equal(result.attention?.attempts, 3);
  assert.equal(result.attention?.error, "Adapter indisponível.");
});

test("execução sem atualização pede verificação, não reinício cego", () => {
  const result = deriveTaskObservability({
    task: { status: "executing", current_step: 4 },
    steps: [{ step_number: 4, status: "running", attempt_count: 1 }],
    isStale: true,
  });

  assert.equal(result.attention?.kind, "stale");
  assert.equal(result.attention?.action, "refresh");
});

test("autocorreção ativa fica visível no monitor", () => {
  const result = deriveTaskObservability({
    task: { status: "executing", current_step: 3 },
    steps: [{
      step_number: 3,
      status: "running",
      attempt_count: 2,
      last_error: { message: "Primeira tentativa falhou." },
    }],
    isStale: false,
  });

  assert.equal(result.attention?.kind, "recovering");
  assert.equal(result.recovery?.active, true);
  assert.equal(result.recovery?.currentAttempt, 2);
});

test("recuperação concluída continua auditável sem novo alerta crítico", () => {
  const result = deriveTaskObservability({
    task: { status: "executing", current_step: 2 },
    steps: [
      {
        step_number: 1,
        status: "succeeded",
        attempt_count: 2,
        last_error: { message: "Falha anterior corrigida." },
      },
      { step_number: 2, status: "running", attempt_count: 1 },
    ],
    isStale: false,
  });

  assert.equal(result.attention, null);
  assert.equal(result.recovery?.active, false);
  assert.equal(result.recovery?.recoveredStep, 1);
  assert.equal(result.recovery?.recoveredAttempts, 2);
});
