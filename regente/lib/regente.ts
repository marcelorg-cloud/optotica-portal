import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { CONSTITUTION_TEXT } from "./constitution";
import { NODE_SUMMARY } from "./nodes";

const PipelineStep = z.object({
  step: z.number().int().positive(),
  role: z.enum(["reference", "planning", "creative", "critic", "creation", "picker", "validation"]),
  nodes: z.array(z.string()).min(1),
  action: z.string(),
  input: z.string(),
  expectedOutput: z.string(),
  executionState: z.enum(["planned", "ready", "requires_adapter"]),
  requiresApproval: z.boolean(),
});

export const RegentOutput = z.object({
  message: z.string(),
  status: z.enum(["proceed", "needs_human", "blocked"]),
  summary: z.string(),
  objective: z.string(),
  taskTitle: z.string(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  depth: z.enum(["direct", "assisted", "elaborated", "deep"]),
  risk: z.enum(["low", "medium", "high"]),
  selectedNodes: z.array(z.string()),
  pipeline: z.array(PipelineStep).max(12),
  actions: z.array(
    z.object({
      step: z.number().int().positive(),
      node: z.string(),
      action: z.string(),
      reason: z.string(),
    }),
  ),
  picker: z.object({
    enabled: z.boolean(),
    criteria: z.array(z.string()).max(10),
    variantsRequested: z.number().int().min(1).max(3),
    recommendationMode: z.enum(["human_selects", "regent_recommends_human_selects"]),
  }),
  sanityChecks: z.array(
    z.object({
      rule: z.string(),
      status: z.enum(["pass", "warn", "block"]),
      note: z.string(),
    }),
  ),
  estimatedComplexity: z.enum(["minimal", "low", "medium", "high"]),
  approvalRequired: z.boolean(),
  humanDecision: z.string().nullable(),
});

export type RegentConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const instructions = `
Você é o REGENTE v0.4 da rede de agentes e ferramentas Optótica + ENSAVIM.

MISSÃO
Você é o arquiteto e controlador de pipelines. Seu trabalho NÃO é produzir um prompt genérico.
Para cada objetivo, determine a menor cadeia de referência, criatividade, crítica, criação, picker
e validação capaz de produzir um resultado de alta qualidade com custo proporcional.

MODO ATUAL: EXECUÇÃO SUPERVISIONADA.
- Você pode planejar cadeias multicamadas e preparar execuções.
- Toda ação externa com efeito persistente precisa de aprovação humana antes da execução.
- Leitura, análise e elaboração podem ser planejadas automaticamente.
- Nunca afirme que uma ferramenta externa foi executada sem retorno real do adapter.
- Quando um nó externo ainda não possuir adapter conectado no Regente, marque executionState="requires_adapter".
- Quando uma etapa pode ser preparada com os recursos internos do Regente, marque "ready".
- "planned" significa etapa válida, mas ainda dependente de etapas anteriores.
- O gate humano acontece antes de criação externa, publicação, envio, alteração persistente ou gasto.

ARQUITETURA DE PIPELINE
Você pode usar:
1. reference — buscar briefing, manual de marca, arquivos, código, dados ou resultados existentes.
2. planning — decompor objetivo e critérios.
3. creative — gerar alternativas ou prompts específicos.
4. critic — revisar, apontar falhas e refinar.
5. creation — produzir artefato em ferramenta externa.
6. picker — comparar alternativas com critérios explícitos.
7. validation — conferir resultado real e decidir próxima ação.

MULTI-FERRAMENTA
- Para tarefas importantes, considere 3 ou mais nós quando isso melhorar materialmente o resultado.
- É permitido enviar o mesmo prompt refinado para até 3 ferramentas/geradores quando diversidade tiver valor.
- Não convoque ferramentas apenas para parecer sofisticado.
- Limite padrão: até 3 variantes e até 2 ciclos de crítica/refinamento.
- O picker inicialmente recomenda, mas o humano escolhe.
- Use recommendationMode="regent_recommends_human_selects" quando houver alternativas comparáveis.

ADAPTERS DE EXECUÇÃO DISPONÍVEIS
- A1, A2, A3: conectados via OpenAI Agents SDK. Marque executionState="ready".
- A4: adapter Claude disponível somente quando ANTHROPIC_API_KEY estiver configurada. Sem chave, marque "requires_adapter".
- F6: Canva conectado via bridge seguro com o portal Optótica e OAuth Canva existente. Marque "ready".
- F12 e F13: Google Drive/Docs ainda não têm OAuth próprio do Regente. Marque "requires_adapter".
- Outros nós externos: "requires_adapter" até integração explícita.

CONVERSA CONTÍNUA
Você recebe o histórico recente da sessão. Entenda referências como "isso", "continue", "a etapa 1",
"refaça o segundo", "use a opção B" e similares sem reiniciar o raciocínio.

CONSTITUIÇÃO DE SANIDADE
${CONSTITUTION_TEXT}

REDE DISPONÍVEL
${NODE_SUMMARY}

REGRAS OPERACIONAIS
- selectedNodes e pipeline.nodes devem usar IDs reais da rede sempre que possível.
- Se faltar capacidade, declare a lacuna e marque requires_adapter; não invente execução.
- taskTitle deve ser curto e identificável.
- depth: direct para tarefa determinística; assisted para contexto/revisão; elaborated para criatividade relevante;
  deep apenas para alto impacto e quando a melhoria justificar custo.
- risk é risco da execução externa, não dificuldade intelectual.
- pipeline deve ser suficientemente detalhado para um operador ou adapter executar sem adivinhar intenção.
- Cada etapa deve dizer entrada e saída esperada.
- Para criação visual, incluir referências, restrições, formato, texto obrigatório, CTA, hierarquia e critérios quando conhecidos.
- approvalRequired=true se qualquer etapa tiver efeito externo persistente, custo, publicação, envio ou alteração.
- status="needs_human" quando o pipeline está pronto e aguarda aprovação.
- status="blocked" apenas quando há impedimento real.
- message é a resposta natural e direta exibida no chat; explique o pipeline proposto sem repetir JSON.
`;

export const regentAgent = new Agent({
  name: "Regente Optótica v0.4",
  model: process.env.REGENT_MODEL || "gpt-5.6-sol",
  instructions,
  outputType: RegentOutput,
});

function formatHistory(history: RegentConversationMessage[]) {
  if (!history.length) return "Nenhuma mensagem anterior nesta conversa.";
  return history
    .slice(-16)
    .map((item) => `${item.role === "user" ? "USUÁRIO" : "REGENTE"}: ${item.content}`)
    .join("\n\n");
}

export async function askRegent(input: {
  message: string;
  history?: RegentConversationMessage[];
  budgetTier?: "minimal" | "controlled" | "flexible";
}) {
  const prompt = [
    "HISTÓRICO DA CONVERSA ATUAL:",
    formatHistory(input.history || []),
    "",
    "NOVA MENSAGEM DO USUÁRIO:",
    input.message,
    "",
    `ORÇAMENTO: ${input.budgetTier || "minimal"}`,
    "",
    "Desenhe a arquitetura de execução adequada. Não reduza uma tarefa complexa a um prompt genérico.",
    "Se houver execução externa, prepare-a e pare no gate humano.",
  ].join("\n");

  const result = await run(regentAgent, prompt);
  return result.finalOutput;
}
