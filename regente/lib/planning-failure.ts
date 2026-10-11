// Only allowlisted diagnoses leave the server. Never expose provider messages,
// request bodies, secret fragments or arbitrary error.code values.
export function planningFailure(error: unknown) {
  const value = error && typeof error === "object" ? error as { code?: unknown; name?: unknown; message?: unknown } : {};
  const code = typeof value.code === "string" ? value.code : "";
  const schemaFailure = code === "invalid_json_schema" ||
    (value.name === "UserError" && typeof value.message === "string" && /(?:Zod schema|Schema field)/.test(value.message));
  if (schemaFailure) return { code: "planning_schema_invalid", retryable: false,
    message: "O planejamento parou por incompatibilidade no contrato de saída. Nenhuma fase foi executada.",
    action: "Solicite correção do contrato no código e novo deploy; repetir a mesma mensagem não corrige esse erro." };
  if (["invalid_api_key", "insufficient_quota", "model_not_found"].includes(code)) return {
    code: code === "invalid_api_key" ? "planning_auth_invalid" : code === "insufficient_quota" ? "planning_quota_unavailable" : "planning_model_unavailable",
    retryable: false, message: "O provedor não permitiu o planejamento. Nenhuma fase foi executada.",
    action: "Confira a chave OpenAI, o saldo/limite e o acesso ao modelo no projeto Regente. Não é necessário configurar Anthropic." };
  if (value.name === "TimeoutError" || value.name === "AbortError" || code === "rate_limit_exceeded") return {
    code: "planning_temporarily_unavailable", retryable: true,
    message: "O planejamento não concluiu dentro dos limites de tempo ou disponibilidade. Nenhuma fase foi executada.",
    action: "Sua mensagem foi preservada. Aguarde e tente planejar novamente nesta conversa; não reinicie missões existentes." };
  return { code: "planning_unconfirmed", retryable: false,
    message: "Não foi possível confirmar o planejamento. Nenhuma fase foi executada.",
    action: "Confira o diagnóstico do servidor antes de repetir. Não houve autorização automática nem avanço de missão." };
}
