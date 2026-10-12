# Regente 1.0 — Ratificação complementar: DM6 condicionada, orçamento no Afinamento, identidade e bridge

**Data:** 12/10/2026  
**Autoridade:** Maestro, ratificação expressa em conversa após proposta consolidada.  
**Estado:** **APROVADO COMO ORIENTAÇÃO FUNCIONAL E PRIORIDADE**, sujeito a testes, autorização específica de despesas/credenciais e implantação técnica segura; não equivale a operação externa já habilitada.  
**Base:** D1–D6 e quatro refinamentos aprovados; DM1–DM10 ratificadas no documento `regente-1.0-decisoes-institucionais-dm01-dm10-2026-10-12.md`. Esta orientação **refina a ordem e a interpretação** de DM6/identidades, sem anular os requisitos de isolamento e controle.

## RC1 — DM6: segregação física adiada de forma condicionada

O **repositório GitHub e o projeto Supabase atuais podem ser mantidos temporariamente** para finalizar sistemas em andamento e desenvolver o Regente sem interromper Optótica, ENSAVIM e outras missões.

Controles compensatórios obrigatórios:
- Restringir execução autônoma a ações com escopo efetivamente limitado, registro, reversibilidade, testes e envelope aprovado.
- Continuar leituras RLS, planejamento, missões, geração textual e propostas de código.
- Não habilitar credenciais administrativas genéricas para agentes, bridges ou Portão.
- **Escrita autônoma privilegiada** com alcance sobre todo o repositório compartilhado, banco compartilhado, DNS ou deploy de produção depende de isolamento equivalente verificado ou segregação física DM6 antes da habilitação.
- Proteger operações de banco por RLS, identidade de serviço limitada e, quando aplicável, funções estreitas e testadas; **RLS não restringe chaves privilegiadas que o contornam**.
- Toda mudança futura de escopo, classe de dados e autonomia requer reavaliação formal da DM6 e ensaios específicos.
- Registrar a segregação futura no backlog, com migração reversível, backups e nenhum rompimento de dependências.

**Consequência:** DM6 não bloqueia os componentes seguros e de baixo privilégio do piloto; permanece gate para escrita autônoma privilegiada e ampla.

## RC2 — Orçamento financeiro da missão na Fase 1 (Afinamento)

Após derivar vínculos e avaliar rotas, a Partitura da Missão deve mostrar:
1. **Custo estimado** por operação e por rota (modelo, volume, câmbio, cota, fonte e data, confiança), agregado por projeto/conta/provedor.
2. **Incerteza explícita:** quando preço/volume/taxa não for verificável, rotular `não estimável` e **não inventar preço** nem liberar automaticamente gasto.
3. **Margem de segurança editável pelo Maestro** e **teto monetário aprovado**: exemplo ilustrativo, estimado R$ 10 e teto máximo R$ 15 (+50%).
4. **Limite máximo** aprovado em moeda e versão da missão/envelope, com valores estimado, reservado, confirmado e saldo exibidos na Execução/Resultados.
5. Antes de cada operação paga, S00 **reserva transacionalmente** uma estimativa conservadora ou valor máximo justificável, dentro do teto. O Portão reconcilia cobranças reais e a incerteza. Sem custo conhecido, não autorizar execução paga.
6. Em teto atingido, novas operações pagas são bloqueadas; tarefas independentes sem custo continuam. Ampliação exige nova decisão registrada.
7. Evitar afirmar que contadores de chamadas ou valores projetados sejam **faturamento real**: a medição precisa de consumo do provedor (tokens, duração, imagens) e conversão transparente.
8. Publicação classe 3 continua condicionada ao pacote final e aprovação específica, mesmo com orçamento aprovado.

**Status de implantação:** apenas orientação ratificada até desenvolvimento/teste específicos; o piloto atual tem teto quantitativo de chamadas de IA, **não** um teto monetário plenamente verificado.

## RC3 — Maestro e Master técnico na mesma identidade humana

O **Maestro e o Master técnico poderão usar a mesma conta/autenticação humana**. Não é obrigatório criar dois logins ou pessoas.

**Separação obrigatória por papel e efeito:** a mesma identidade executa ações de aprovação institucional quando explicitamente autenticada e confirmada como Maestro; operações administrativas continuam auditadas como Master. Para classe 3, registar sessão, papel, pacote final/hash, decisão e confirmação reforçada conforme risco. Agentes não podem forjar aprovações ou assumir papel humano.

**Identidade de serviço do S00/Portão permanece distinta da humana:** credenciais e tokens limitados ao backend, sem exposição a agentes ou contexto de modelo. Igualdade entre Maestro e Master não implica igualdade com a identidade técnica dos executores.

## RC4 — Gateway e bridges redundantes

O Regente mantém um **Gateway de Instrumentos próprio, governado pelo S00**, capaz de escolher por missão/operação rota direta ou bridge por custo, prazo, escopo, conta/destino, confiabilidade e histórico.

**Composio é a primeira candidata a ser avaliada** (cobertura, modelo de custos, OAuth gerenciado, MCP, retenção, operações reais e domínios de falha), **não fornecedor já escolhido/contratado/conectado**.

A avaliação compara alternativas, especialmente Pipedream Connect, n8n e bridges próprias do Portal, sem criar dependência estrutural de fornecedor único. Priorizar gateway neutro e possibilidade de múltiplas bridges redundantes, mas **uma rota ativa por vínculo operacional e instância**.

**Não presumir equivalência:** conta conectada via plugin ChatGPT não transfere credenciais automaticamente ao runtime. A configuração de cada conta externa pode ainda exigir OAuth/decisão humana. Bridges com credenciais sob custódia do provedor devem ficar sob escopos mínimos contratados e políticas de retenção; S00 permanece único ponto de autorização/despacho, embora não seja o custodiante físico de tokens gerenciados por terceiros.

## RC5 — Ordem ratificada de execução

1. UI de orçamento previsto e teto aprovado na Fase 1, com metering e bloqueios efetivos em etapa técnica.
2. Identidade humana unificada Maestro/Master com papéis/decisões auditáveis, serviço técnico separado.
3. Gateway neutro com prova de cobertura/custo Composio como primeira candidata.
4. Conexões por projeto/conta e adapters estreitos, sem escrita não testada.
5. Validação E2E, isolamento, reconciliação e ativação graduada de rotas.
6. Segregação física DM6 **planejada**, antecipada antes de qualquer autonomia privilegiada ampla em infraestrutura compartilhada.

## Critérios de não-conformidade

- Não interpretar `ratificado` como autorização de gastos com bridge, compra de serviço, leitura de e-mails, OAuth, migração ou privilégios administrativos.
- Não afirmar `custo real` sem medição; não autorizar custo desconhecido por padrão.
- Não autorizar operação de classe 3 só porque o envelope financeiro foi aprovado.
- Não tornar a conta G-PES contingência de escrita da G-OPT; recursos institucionais elegíveis não equivalem a acesso irrestrito.
- Preservar decisões D1–D6 e DM1–DM10, com esta ratificação explicitando DM6 condicionada.

**Status documental:** este arquivo registra a nova decisão do Maestro; PR/merge e implementação são etapas distintas.
