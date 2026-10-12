# Regente 1.0 — Proposta documental para Grade: recursos, autorização e rotas

**Estado:** MINUTA PARA REVISÃO — fundamentada nas DM1–DM10 aprovadas em 12/10/2026. **Não aplicada à Grade canônica nem ao runtime.**  
**Complementa:** D1–D6, quatro refinamentos aprovados, diretrizes de conexões redundantes e Mapa de Conexões da Missão. **Não altera a Constituição.**

## 1. Modelo institucional

```text
Goraieb Instituto da Visão
 ├─ Políticas, Biblioteca Institucional, Catálogo de Participantes e Recursos
 ├─ Projeto ativo: Optótica
 │   └─ Missões → resultados próprios, permissões, custos, conexões
 ├─ Projeto ativo: ENSAVIM
 │   └─ Missões → resultados próprios, permissões, custos, conexões
 ├─ Projeto reservado: Born Robot
 │   └─ Missões de engenharia do Regente (não governança)
 ├─ Contexto reservado: Instituto — Governança (DM10)
 │   └─ Missões da Constituição, Grade, políticas e aprovações
 └─ Regente/S00 → governa e coordena sem fundir os contextos
```

**Observação:** os estados acima descrevem a arquitetura-alvo; o estado de ativação de cada projeto ainda precisa ser registrado pelo S00. Não inferir `ativo` por existir um identificador no código.

### Entidades

| Entidade | Responsabilidade | Fronteira |
| --- | --- | --- |
| Instituto | Governança institucional e titularidade de recursos comuns | Não absorve dados específicos por padrão |
| Projeto | Contexto organizacional com missões, recursos, orçamento, elegibilidade | Não compartilha conteúdo por semelhança temática |
| Missão | Contexto mínimo de execução, envelope, Mapa de Recursos e Conexões, entregáveis | Dados isolados por missão e projeto |
| Pessoa | Titular humano de recursos (ex.: G-PES) e de decisões | Conta pessoal não pertence automaticamente ao Instituto |
| Participante | Papel/agente/serviço/instrumento catalogado (C*, A*, F*, S00) | Capacidade ou papel ≠ conta/recurso |
| Recurso | Conta, contêiner, item ou serviço concreto, com proprietário/política | Credenciais não são recursos compartilháveis |
| Rota | Transporte concreto para operação em destino efetivo | Rota ≠ autorização nem identidade de recurso |
| Contrato de capacidade | Projeto fornecedor presta serviço a projeto consumidor | Fornecedor continua sendo projeto, não novo F |
| Decisão/concessão | Aprovação humana verificável, objeto/escopo/prazo/versão | Não substituída por parecer de IA |
| Vínculo operacional | Missão × operador × destino/recurso × operação; uma rota ativa | Contingências não executam em paralelo |
| Instância | Tentativa de efeito identificada de modo único e independente da rota | Efeito incerto sempre reconciliado |

## 2. Recursos — compartilhamento e classe de dados são eixos independentes

| Categoria | Proprietário possível | Elegibilidade básica |
| --- | --- | --- |
| `institucional_comum` | Instituto | Projetos ativados e não excluídos; classe ≤ Interno; **operações continuam negadas por padrão** |
| `exclusivo` | Projeto / Pessoa | Somente contexto proprietário, salvo concessão ou transferência aprovada |
| `compartilhado` | Instituto / Projeto | Projetos explicitamente incluídos em política versionada, por operação e prazo |
| `restrito` | Qualquer | Lista específica de participantes/missões, inclusive dentro do projeto proprietário |

`delegado` é **concessão específica por operação**, não categoria. `Pessoal`, `Sensível` e `Segredo` são **classes de dados** de RT-07, não categorias de compartilhamento. A política efetiva usa a combinação mais restritiva.

**Herança:** conta → contêiner → item. Um filho pode ser mais restritivo. Ampliar em relação ao pai exige decisão registrada e análise de impacto. Uma classificação ampliada produz nova versão aplicável **apenas a novas missões/envelopes**; restrições passam a valer imediatamente. Outputs de missão pertencem ao projeto até promoção aprovada, com derivado versionado e original preservado.

### Bases de acesso (uma por vínculo)

- `propria`: recurso pertence ao projeto da missão;
- `institucional`: recurso comum elegível de propriedade do Instituto;
- `compartilhamento`: compartilhamento explícito vigente e identificável;
- `contrato`: contrato de capacidade de projeto fornecedor ativo e versionado;
- `concessao`: decisão específica autenticada, válida para instância/operação e finalidade.

Sem base válida no recurso efetivo (avaliado até o item) = **não elegível**.

## 3. RT-20, E14 e ajustes normativos para apreciação da Grade

### RT-20 — Escopo e compartilhamento (texto proposto)

> Todo participante declara os projetos atendidos; todo recurso declara proprietário (Instituto, Projeto ou Pessoa), categoria de compartilhamento, classe de dados e política efetiva. Recursos institucionais comuns são elegíveis por padrão para projetos ativos, respeitadas as restrições e a classe de dados. Outros recursos exigem base válida de acesso. A operação continua negada por padrão fora dos tetos, envelopes e decisões aplicáveis. Ampliação não é retroativa; restrição é imediata.

### E14a — Escopo do participante

O projeto da missão pertence ao escopo do operador e do instrumento. A identidade do operador é emitida/atestada pelo S00, nunca autodeclarada pelo texto do agente.

### E14b — Base de acesso ao recurso

O recurso efetivo (conta → contêiner → item) possui base vigente: própria, institucional, compartilhamento, contrato ou concessão. A classe e finalidade dos dados são admissíveis. Restrições herdadas e escopos do recurso prevalecem.

### Complementos, sem nova RT

- **RT-02 (parecer ≠ autorização):** o Autorizador do S00 decide deterministicamente; o Portão executa por código único; parecer de IA nunca autoriza.
- **RT-13 (versões e não retroatividade):** ampliação de proprietário/categoria/classe exige decisão, análise e nova versão para futuras missões; restrição imediata.
- **RT-07, RT-17, RT-18:** permanecem, respectivamente, controle de dados, equivalência de destino efetivo e proibição de ampliar permissões pela troca de rota.
- **RT-15/RT-16/RT-19 (propostas de conexões):** instância idempotente, uma rota ativa por vínculo, fallback somente conforme autorização e testes.

## 4. S00 — Avaliação, aplicação e prova

```text
Maestro / governança → política, limites e decisões
      |
Agente identificado → pedido tipado (sem credenciais) → S00 Autorizador
                                                    | negar → evento e justificativa
                                                    | permitir → decisão versionada
                                                    v
                                   S00 Portão de Execução (cofre)
                                          | token único/lease
                                          v
                                  adapter/ponte própria (verifica)
                                          | escopos mínimos do provedor
                                          v
                                    efeito + evidência
                                          v
                               livro de uso + C08 auditoria
```

**Autorizador (PDP):** regra determinística sobre identidade, contexto, participação, base de acesso, finalidade/classe de dados, operação/classe 1/2/3, rota ativa, orçamento, decisão do Maestro e ausência de paradas. Falha de um atributo essencial = negar. Resultado é imutável e referenciado.

**Portão de Execução (PEP):** única custódia operacional das credenciais; reserva orçamento/limites; emite token de operação de uso único, curto e vinculado a instância, recurso, rota, operação e idempotência; despacha, registra evidência, concilia efeitos incertos. O adapter rejeita token faltante, inválido, reutilizado, de outro destino ou expirado. A credencial verdadeira não aparece no prompt, nos outputs, no repositório ou na fila do hub.

**Defesa em profundidade:** identidade de serviço própria; menores escopos no provedor; RLS por projeto; saída de rede limitada onde viável; reconciliação de efeitos órfãos; segregação DM6 antes de escrita autônoma. Uma conexão ChatGPT/plugin fora do runtime permanece transporte assistido de confiança limitada, não equivalência automática a API autenticada do Regente.

### Acesso efetivo — todas as condições necessárias

```text
PERMITIR = identidade_vigente
        ∧ projeto_e_missao_ativos
        ∧ escopo_participante(E14a)
        ∧ base_recurso(E14b)
        ∧ classe_e_finalidade_admissiveis
        ∧ teto ∩ envelope ∩ condições (ou decisão classe 3 sobre hash)
        ∧ rota_ativa_elegivel
        ∧ orçamento_reservado
        ∧ nenhuma_parada/pausa/disjuntor
```

**Separação de funções:** Maestro define e aprova políticas; C04 declara os vínculos necessários; C05 (Spalla) compara prontidão e propõe rotas; A5 executa probes; C07 ensaia; C01 verifica coerência; C08 audita; **somente S00 autoriza e aplica**.

## 5. Mapa de Conexões e Recursos na Fase 1

Cada missão recebe: projeto e finalidade, operadores, instrumentos/capacidades, recursos efetivos por alias e propriedade, categoria e classe de dados, base de acesso e evidências E14a/E14b, rota principal e contingências por vínculo, capacidade/escopo, custo/limites, domínios de falha e versão de seleção.

- Vínculo lógico entre papéis (`informa`) utiliza barramento interno S00; não cria OAuth por par.
- Rotas redundantes podem coexistir no catálogo, porém só **uma ativa por vínculo e operação**, selecionada na Fase 1; contingências ordenadas exigem equivalência de destino efetivo e compatibilidade.
- Consulta gratuita de prontidão prioriza rota principal e primeira contingência; não fazer probes pagos sem envelope. Rotas não ensaiadas são identificadas como tal.
- Mapa anexado à Partitura da Missão, verificado por C01, auditado por C08 e **aprovado com o envelope**.
- Troca de rota incerta não repete efeito sem reconciliação. Classe 3 exige reconfirmação da versão final e destino; falha de segurança não aciona fallback automático.
- Na Fase 2, livro planejado × usado inclui versão, rota, custo, instância e evidência. Na Fase 3, outputs pertencem ao projeto da missão, e promoção institucional exige DM9.

## 6. Serviços compartilhados por contrato de capacidade

**Exemplo proposto, não habilitado:** Optótica oferece ponte Canva do Portal ao ENSAVIM via contrato `CC-OPT-01` (operações `design.create` e `design.export`, entrada/saída tipadas, limites, retenção, custo e versões). A conta/pasta do Canva deve ser elegível para ENSAVIM e o contrato vigente. O **consumidor** detém os outputs e recebe o débito por padrão; suspensão do contrato degrada somente vínculos dependentes.

Um projeto fornecedor **não vira ferramenta F**; o contrato reutiliza F4/F6 conforme a capacidade. Contas e repositórios de projetos diversos não são contingência de escrita entre si.

## 7. Fronteira de infraestrutura — DM6

O repositório `optotica-portal` e o Supabase `optotica-dev` ainda acomodam partes da Optótica e do Regente. O isolamento por caminho no código não equivale a escopos mínimos no provedor. **Antes de qualquer escrita autônoma:** repositório próprio do Regente, projeto Supabase próprio para S00, plano de migração e rollback, testes de identidade, RLS e permissões por repositório/ambiente. Este PR apenas descreve o plano.

## 8. Destino das alterações

As seções deste arquivo são **propostas de incorporação** à Grade e às partituras. A incorporação canônica, revisão dos 29 participantes mais F15, dados operacionais e mudanças no banco requerem aprovações e etapas separadas. **Nenhuma implementação, conexão, deploy ou permissão** é ativada pelo texto.
