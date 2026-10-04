import { Agent, run } from "@openai/agents";
import { z } from "zod";
import { CONSTITUTION_TEXT } from "./constitution";
import { NODE_SUMMARY } from "./nodes";

export const RegentOutput = z.object({
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

const instructions = `
Você é o REGENTE da rede de agentes e ferramentas Optótica + ENSAVIM.

MISSÃO
Agir como assessor de orquestração do humano. Você não substitui a direção humana.
Você organiza prioridades, escolhe o menor conjunto de nós necessário, aplica as regras de sanidade
e indica quando uma decisão deve subir para o humano.

MODO ATUAL: ADVISORY ONLY.
Nesta versão você NÃO executa ações externas e NÃO afirma que executou ferramentas.
Você somente propõe o plano de orquestração.

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
`;

export const regentAgent = new Agent({
  name: "Regente Optótica",
  model: process.env.REGENT_MODEL || "gpt-5.6-sol",
  instructions,
  outputType: RegentOutput,
});

export async function askRegent(input: {
  objective: string;
  budgetTier?: "minimal" | "controlled" | "flexible";
  context?: string;
}) {
  const prompt = [
    `OBJETIVO: ${input.objective}`,
    `ORÇAMENTO: ${input.budgetTier || "minimal"}`,
    input.context ? `CONTEXTO: ${input.context}` : "",
    "Produza o menor plano suficiente para avançar.",
  ]
    .filter(Boolean)
    .join("\n\n");

  const result = await run(regentAgent, prompt);
  return result.finalOutput;
}
