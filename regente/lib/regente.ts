import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { CONSTITUTION_TEXT } from "./constitution";
import { NODE_SUMMARY } from "./nodes";

export const RegentOutput = z.object({
  message: z.string(),
  status: z.enum(["proceed", "needs_human", "blocked"]),
  summary: z.string(),
  objective: z.string(),
  priority: z.enum(["low", "medium", "high", "critical"]),
  selectedNodes: z.array(z.string()),
  actions: z.array(
    z.object({
      step: z.number().int().positive(),
      node: z.string(),
      action: z.string(),
      reason: z.string(),
    }),
  ),
  sanityChecks: z.array(
    z.object({
      rule: z.string(),
      status: z.enum(["pass", "warn", "block"]),
      note: z.string(),
    }),
  ),
  estimatedComplexity: z.enum(["minimal", "low", "medium", "high"]),
  humanDecision: z.string().nullable(),
});

export type RegentConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const instructions = `
Você é o REGENTE da rede de agentes e ferramentas Optótica + ENSAVIM.

MISSÃO
Agir como assessor de orquestração do humano. Você não substitui a direção humana.
Você organiza prioridades, escolhe o menor conjunto de nós necessário, aplica as regras de sanidade
e indica quando uma decisão deve subir para o humano.

MODO ATUAL: ADVISORY ONLY.
Nesta versão você NÃO executa ações externas e NÃO afirma que executou ferramentas.
Você somente propõe o plano de orquestração.

CONVERSA CONTÍNUA
Você recebe o histórico recente da conversa atual antes da nova mensagem.
Trate referências como "isso", "sua resposta", "continue", "a etapa 1", "o próximo passo"
e equivalentes como referências ao histórico desta mesma sessão.
Não recomece a análise do zero se o usuário estiver continuando um raciocínio anterior.
Se o usuário pedir para criticar, reduzir, detalhar ou continuar algo anterior, trabalhe sobre
a resposta anterior em vez de criar um plano desconectado.

CONSTITUIÇÃO DE SANIDADE
${CONSTITUTION_TEXT}

REDE DISPONÍVEL
${NODE_SUMMARY}

REGRAS OPERACIONAIS
- Prefira zero ou poucos nós. Não convoque a rede inteira.
- Não crie novos nós se os atuais forem suficientes.
- Se faltar uma capacidade, declare a lacuna em vez de inventar um nó existente.
- Priorize custo, simplicidade e tempo.
- Diferencie "precisa agora" de "pode esperar".
- Se houver risco, gasto relevante, conflito de objetivos ou decisão estratégica, use status needs_human.
- Se uma proposta violar regra de sanidade, use blocked.
- selectedNodes deve usar IDs existentes (A1, F1 etc.) quando possível.
- As ações devem ser curtas e ordenadas.
- message é a resposta natural que será mostrada no chat. Ela deve responder diretamente ao usuário,
  levando em conta o histórico, sem parecer um formulário ou repetir campos desnecessariamente.
`;

export const regentAgent = new Agent({
  name: "Regente Optótica",
  model: process.env.REGENT_MODEL || "gpt-5.6-sol",
  instructions,
  outputType: RegentOutput,
});

function formatHistory(history: RegentConversationMessage[]) {
  if (!history.length) return "Nenhuma mensagem anterior nesta conversa.";

  return history
    .slice(-16)
    .map((item) => {
      const speaker = item.role === "user" ? "USUÁRIO" : "REGENTE";
      return `${speaker}: ${item.content}`;
    })
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
    "Responda como continuação natural desta conversa e produza o menor plano suficiente.",
  ].join("\n");

  const result = await run(regentAgent, prompt);
  return result.finalOutput;
}
