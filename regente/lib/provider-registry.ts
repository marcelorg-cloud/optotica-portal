export type GuardianProviderId = "openai" | "claude";
export type ProviderEnvironment = Record<string, string | undefined>;

export type GuardianProvider = {
  id: GuardianProviderId;
  label: string;
  roles: string[];
  state: "configured" | "requires_configuration" | "manual";
  route: "openai_agents_sdk" | "manual_external_review";
  requestedRoute: string | null;
  transport: "openai_https" | "human_import";
  model: string | null;
  configured: boolean;
  adapterConnected: boolean;
  automatic: boolean;
  authenticated: boolean | null;
  authorized: boolean | null;
  operational: boolean | null;
  financial: "not_verified";
  requiredConfiguration: string[];
  sourceVersion: "0.7.0";
  release: "v0.7";
};

export function credentialPresent(name: string, env: ProviderEnvironment = process.env) {
  return Boolean(env[name]?.trim());
}

// Roles and transports are separate. Setting a key or model alone must never
// advertise an adapter that does not exist. Interactive Claude reviews have an
// explicit human-import transport; they are not Anthropic API executions.
export function guardianProviders(env: ProviderEnvironment = process.env): GuardianProvider[] {
  const openAIConfigured = credentialPresent("OPENAI_API_KEY", env);
  const requestedRouteValue = env.REGENT_CLAUDE_PROVIDER?.trim();
  const requestedClaudeRoute = requestedRouteValue
    ? ["manual", "anthropic", "vercel_ai_gateway", "google_vertex", "amazon_bedrock"].includes(requestedRouteValue)
      ? requestedRouteValue : "unsupported_route" : null;
  const requestedModel = env.REGENT_REVIEW_MODEL?.trim() || env.REGENT_RECOVERY_MODEL?.trim() || env.REGENT_MODEL?.trim();
  const model = requestedModel
    ? /^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(requestedModel) &&
      !/^(?:sk[-_]|cnvca|gh[pousr]_|github_pat_)/i.test(requestedModel) ? requestedModel : null
    : "gpt-5.6-sol";
  return [
    {
      id: "openai",
      label: "Guardião OpenAI / ChatGPT",
      roles: ["programação", "revisão independente", "recovery"],
      state: openAIConfigured ? "configured" : "requires_configuration",
      route: "openai_agents_sdk",
      requestedRoute: null,
      transport: "openai_https",
      model,
      configured: openAIConfigured,
      adapterConnected: true,
      automatic: true,
      authenticated: null,
      authorized: null,
      operational: null,
      financial: "not_verified",
      requiredConfiguration: [
        ...(!openAIConfigured ? ["Configurar OPENAI_API_KEY no runtime do Regente."] : []),
        ...(model === null ? ["Conferir o identificador do modelo do guardião; valor inválido ou sensível omitido do relatório."] : []),
      ],
      sourceVersion: "0.7.0",
      release: "v0.7",
    },
    {
      id: "claude",
      label: "Guardião Claude — revisão externa assistida",
      roles: ["contraponto", "revisão de arquitetura", "programação"],
      state: "manual",
      route: "manual_external_review",
      requestedRoute: requestedClaudeRoute,
      transport: "human_import",
      model: null,
      configured: true,
      adapterConnected: true,
      automatic: false,
      authenticated: null,
      authorized: null,
      operational: null,
      financial: "not_verified",
      requiredConfiguration: [
        "Baixar o pacote do guardião, revisar na sua conta Claude e importar o parecer no Regente.",
        ...(requestedClaudeRoute && requestedClaudeRoute !== "manual"
          ? ["A rota programática solicitada ainda não possui adapter validado nesta versão; não é ativada pela presença de uma chave."]
          : []),
      ],
      sourceVersion: "0.7.0",
      release: "v0.7",
    },
  ];
}

