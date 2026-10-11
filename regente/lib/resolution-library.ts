/**
 * Regente v0.8 foundation — versioned, advisory resolution catalogue.
 * Pure metadata. No secrets, provider calls, patient data, state changes or
 * claim that any case has been verified in the current environment.
 */
export type ResolutionKind =
  | "adapter_unavailable" | "identity_or_scope" | "external_effect_unknown"
  | "provider_limit" | "source_conflict" | "output_contract"
  | "organizer_dissonance" | "sensitive_context"
  | "blocked_dependency" | "version_divergence";

export type ResolutionEntry = {
  id: string;
  kind: ResolutionKind;
  title: string;
  status: "proposal";
  scope: "universal";
  version: "0.1.0";
  affectedRoles: string[];
  diagnosticQuestions: string[];
  safeOptions: string[];
  requiredEvidence: string[];
  requiresHumanDecision: boolean;
  forbids: string[];
};
export const RESOLUTION_LIBRARY_VERSION = "0.1.0";
export const RESOLUTION_CATALOGUE: readonly ResolutionEntry[] = [
  {
    id:"BR-001",kind:"adapter_unavailable",title:"Adapter indisponível",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["spalla","orquestrador","bibliotecario"],
    diagnosticQuestions:["O adapter existe no runtime correto?","Quais dependentes são afetados?"],
    safeOptions:["Prosseguir apenas com tarefas independentes.","Propor substituto equivalente e solicitar nova revisão da partitura."],
    requiredEvidence:["Inventário real do runtime.","Dependências e critérios essenciais da missão."],
    requiresHumanDecision:true,forbids:["Simular execução de nó inexistente.","Marcar saída obrigatória como concluída."],
  },
  {
    id:"BR-002",kind:"identity_or_scope",title:"Conta, OAuth ou permissão divergente",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["spalla","ensaiador"],
    diagnosticQuestions:["A identidade correta e os escopos estão confirmados?","Qual ambiente está ativo?"],
    safeOptions:["Suspender a ação externa afetada.","Verificar metadados de identidade sem expor segredo."],
    requiredEvidence:["Resultado real de verificação de identidade e escopos."],
    requiresHumanDecision:true,forbids:["Trocar identidades à força.","Expor token ou chave."],
  },
  {
    id:"BR-003",kind:"external_effect_unknown",title:"Efeito externo não confirmado",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["spalla","auditor_harmonia"],
    diagnosticQuestions:["Existe run canônico?","O efeito externo aconteceu?"],
    safeOptions:["Conciliar o run e os outputs existentes antes de qualquer retomada."],
    requiredEvidence:["Run persistido.","Evidência da operação no provedor."],
    requiresHumanDecision:true,forbids:["Repetir criação irreversível com resultado incerto."],
  },
  {
    id:"BR-004",kind:"provider_limit",title:"Limite de provedor, rate limit ou cobrança",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["spalla","orquestrador"],
    diagnosticQuestions:["O erro é temporário, estrutural ou de faturamento?"],
    safeOptions:["Adiar apenas o dependente.","Tentar novamente somente se idempotente, autorizado e dentro do limite."],
    requiredEvidence:["Código de erro sanitizado.","Política de retry e orçamento efetivo."],
    requiresHumanDecision:true,forbids:["Repetir billing/configuração permanentemente inválidos."],
  },
  {
    id:"BR-005",kind:"source_conflict",title:"Fonte divergente ou obsoleta",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["bibliotecario","auditor_harmonia"],
    diagnosticQuestions:["Qual documento está aprovado e vigente?","Há evidência atual de alteração?"],
    safeOptions:["Preservar ambas as fontes e pedir resolução fundamentada."],
    requiredEvidence:["IDs, versões, aprovação e datas das fontes."],
    requiresHumanDecision:true,forbids:["Escolher versão sem proveniência.","Tratar hipótese como política aprovada."],
  },
  {
    id:"BR-006",kind:"output_contract",title:"Falha de ensaio ou contrato de output",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["ensaiador","spalla"],
    diagnosticQuestions:["Qual contrato foi violado?","É reproduzível em ambiente seguro?"],
    safeOptions:["Reproduzir com fixture ou leitura.","Isolar o componente afetado."],
    requiredEvidence:["Contrato versionado.","Resultado do ensaio sem efeito externo."],
    requiresHumanDecision:false,forbids:["Executar mutações em produção como teste."],
  },
  {
    id:"BR-007",kind:"organizer_dissonance",title:"Divergência entre organizadores",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["auditor_harmonia","regente","direcao_musical"],
    diagnosticQuestions:["Há evidência para tese e antítese?","O desacordo é criativo ou factual?"],
    safeOptions:["Registrar argumentos e testes que possam discriminar as alternativas.","Manter divergência não resolvida se necessário."],
    requiredEvidence:["Pareceres da mesma partitura.","Fontes dos argumentos."],
    requiresHumanDecision:true,forbids:["Votar verdade por maioria de modelos.","Apagar opinião minoritária fundamentada."],
  },
  {
    id:"BR-008",kind:"sensitive_context",title:"Contexto pessoal/clínico não minimizado",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["bibliotecario","direcao_musical"],
    diagnosticQuestions:["Qual classe de dados?","Existe autorização específica e minimização demonstrada?"],
    safeOptions:["Reter o contexto restrito e solicitar classificação/filtragem autorizada."],
    requiredEvidence:["Classificação de dados.","Política e decisão de acesso."],
    requiresHumanDecision:true,forbids:["Replicar conteúdo clínico entre agentes.","Adicionar logs pessoais à biblioteca geral."],
  },
  {
    id:"BR-009",kind:"blocked_dependency",title:"Dependência crítica bloqueada",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["orquestrador","compositor","ensaiador"],
    diagnosticQuestions:["Quais tarefas realmente dependem da falha?","Que meios equivalentes são autorizáveis?"],
    safeOptions:["Prosseguir trabalhos independentes.","Reorquestrar meios sem descartar critérios essenciais."],
    requiredEvidence:["Grafo de dependências.","Critérios de sucesso indispensáveis."],
    requiresHumanDecision:true,forbids:["Tratar deferred como succeeded.","Autorizar alternativa por parecer de IA."],
  },
  {
    id:"BR-010",kind:"version_divergence",title:"Deployment, migração e contrato divergentes",status:"proposal",scope:"universal",version:"0.1.0",
    affectedRoles:["spalla","ensaiador","auditor_harmonia"],
    diagnosticQuestions:["Quais commits e esquemas estão ativos?","Existe mudança incompatível em andamento?"],
    safeOptions:["Inspecionar versões sem mutações.","Pausar operações afetadas até reconciliar o contrato."],
    requiredEvidence:["Commit/deployment.","Migrações aplicadas.","Contratos de API e esquema."],
    requiresHumanDecision:true,forbids:["Migrar missões ativas automaticamente.","Inferir versão produtiva por README."],
  },
] as const;

export type ResolutionRequest = {
  kind: ResolutionKind;
  evidenceRefs: readonly string[];
  dataClass: "public" | "internal_redacted" | "restricted";
  workId?: string;
};
/** Exact-type retrieval deliberately precedes any model-assisted search. */
export function suggestResolutionCases(request: ResolutionRequest) {
  if (request.dataClass === "restricted") {
    return { status:"restricted_context" as const, matches:[] as ResolutionEntry[], nextAction:"Classificar e minimizar dados antes de consultar um novo agente." };
  }
  if (request.evidenceRefs.length>20 || request.evidenceRefs.some(s=>typeof s!=="string" || s.length>160)) throw new Error("invalid_evidence_references");
  const matches=RESOLUTION_CATALOGUE.filter(p=>p.kind===request.kind);
  return {
    status:matches.length?"guidance_only" as const:"unknown_blocker" as const,
    matches,
    nextAction:matches.length
      ? "Conferir evidências, ambiente e critérios da missão antes de propor ou autorizar um contorno."
      : "Registrar incidente como hipótese e solicitar investigação baseada em evidências.",
  };
}
