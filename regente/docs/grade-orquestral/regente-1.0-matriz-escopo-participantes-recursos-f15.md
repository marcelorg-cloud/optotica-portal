# Regente 1.0 — Inventário de escopo por projeto (29 participantes + F15)

**Estado:** matriz documental de preparação. DM3/DM4/DM8 e DM10 estão **aprovadas**; demais escopos sugeridos nesta matriz permanecem `propostos / a confirmar` até ratificação específica e comprovação técnica.  
**Fonte:** Grade Orquestral e pareceres técnicos de 12/10/2026; preservar IDs C01–C08, A1–A6, F1–F14, S00; acrescentar **F15 Gmail** no estado proposto.  
**Restrição de publicação:** o repositório é público; **nenhum identificador real de conta, pasta, equipe, remetente, endereço de e-mail ou segredo**.

## 1. Matriz de participantes e escopo

| ID | Participante | Escopo proposto/ratificado | Condição operacional | Estado de aceitação |
| --- | --- | --- | --- | --- |
| **C01** | Orientação de Coerência | Instituto (transversal) | Base D1; verificar finalidade de uso entre projetos | Definição de papel central |
| **C02** | Regente | Instituto (transversal) | Acompanha estados e uso entre projetos; não seleciona rota nem autoriza | Definição de papel central |
| **C03** | Compositor | Instituto (transversal) | Pede capacidades; não atribui credencial | Definição de papel central |
| **C04** | Orquestrador | Instituto (transversal) | Define vínculos e base de acesso; pode contestar rota por impacto | Definição de papel central |
| **C05** | Spalla | Instituto (transversal) | Afinação, comparação e proposta de mapa; não instala nem autoriza | Definição de papel central |
| **C06** | Bibliotecário | Instituto (transversal) | Biblioteca segmentada por projeto e categoria | Definição de papel central |
| **C07** | Ensaiador | Instituto (transversal) | Testes de isolamento, idempotência e troca | Definição de papel central |
| **C08** | Auditor de Harmonia | Instituto (transversal) | Auditoria independente; parecer não autoriza | Definição de papel central |
| **A1** | Engenharia | Optótica + Born Robot | DM8 aprovado: contextos e infraestrutura segregados | Aprovado, implementação pendente |
| **A2** | Produto e Fluxos Optótica | Optótica | Uso excepcional em outros projetos a confirmar | Matriz inicial; ratificação específica pendente |
| **A3** | Conteúdo ENSAVIM | ENSAVIM | Criação editorial; publicação sob decisão classe 3 | Matriz inicial; ratificação específica pendente |
| **A4** | Revisor independente OpenAI | Instituto (transversal) | Revisão só de outputs autorizados por missão; independência declarada | Matriz inicial |
| **A5** | Verificação Local | Instituto (transversal) | Preflight por rota, operação, ambiente e recurso; não autoriza | Matriz inicial |
| **A6** | Revisão Externa Claude | Instituto (transversal) | Manual na instalação atual; API não comprovada | Matriz inicial |
| **F1** | GitHub | Optótica + Born Robot | Cada repositório é recurso efetivo; permissão de escrita não se limita à pasta; DM6 | Escopo por repositório a confirmar |
| **F2** | Vercel | Optótica + Born Robot | Projetos/ambientes Vercel por projeto; expansão a ENSAVIM por decisão | Escopo por conta/ambiente a confirmar |
| **F3** | Supabase | Optótica + Born Robot | F3-O (dados Optótica) ≠ F3-R (S00); DM6 exige segregação | Separação ainda não implementada |
| **F4** | Replicate / catálogo | Optótica | Ponte do Portal; eventualmente serviço oferecido por contrato | Matriz inicial; operador a confirmar |
| **F5** | Canva prova online | Optótica | Conta, modelos e dados do Portal próprios | Matriz inicial; operador a confirmar |
| **F6** | Canva criativos | ENSAVIM | Ponte do Portal é recurso Optótica; requer contrato de capacidade para ENSAVIM | Escopo adicional Optótica a confirmar |
| **F7** | HeyGen | ENSAVIM | Conta/avatares por projeto; inclusão Optótica a confirmar | Escopo adicional a confirmar |
| **F8** | RapidAPI catálogo | Optótica | Endpoint/licença e operador específicos do catálogo | Matriz inicial; operador a confirmar |
| **F9** | Meta / WhatsApp | Optótica | ENSAVIM e contas Instagram/Ads exigem recursos distintos e decisão; Windsor é rota F9 | ENSAVIM e operador a confirmar |
| **F10** | Resend | Optótica | Envios transacionais específicos; não é contingência automática do Gmail | Matriz inicial; operador a confirmar |
| **F11** | Cloudflare | Optótica | Zona DNS e projeto efetivos; produção e DNS exigem gate | Matriz inicial; operador a confirmar |
| **F12** | Google Drive | G-OPT: Optótica + ENSAVIM designado; G-PES/Orquestra: Instituto | A conta inteira G-OPT não é compartilhada; cada contêiner tem política própria | G-OPT/G-PES conforme DM3/DM4; conexão real não verificada |
| **F13** | Google Docs | G-OPT: Optótica + ENSAVIM designado; G-PES/Orquestra: Instituto | Mesmo domínio Google, contratos/operações distintos | Contas e escopos ainda não verificados no runtime |
| **F14** | Google Planilhas | G-OPT: Optótica + ENSAVIM designado; G-PES/Orquestra: Instituto | Grade institucional acessível apenas pelo contêiner elegível e missão autorizada | Contas e escopos ainda não verificados no runtime |
| **F15** | Gmail — proposto | G-OPT: Optótica + ENSAVIM designado; G-PES: somente finalidade Instituto restrita | Somente perfil/estado até CE14; envio externo exige hash final, decisão classe 3; sem leitura de conteúdo | Participante proposto, não habilitado |
| **S00** | Núcleo de Sincronia | Instituto (transversal) | Determinístico; Autorizador + Portão, orçamento, idempotência e logs; segregação DM6 | Arquitetura aprovada DM7, implementação completa pendente |

**Total conferido:** 30 participantes: 8 C + 6 A + 15 F + 1 S00. O acréscimo F15 não renumera os instrumentos existentes. `Instituto` significa potencial uso transversal **entre projetos ativados**, nunca partilha indiscriminada do contexto ou das credenciais.

## 2. Registro documental de contas e contêineres por alias

| Alias | Proprietário | Recurso e categoria proposta/ratificada | Projeto elegível | Limite |
| --- | --- | --- | --- | --- |
| `G-OPT` | Projeto Optótica | Conta raiz `exclusivo`, classe Pessoal por padrão | Optótica | Sem acesso global a ENSAVIM |
| `G-OPT/ENSAVIM-APOIO` | Projeto Optótica | Contêiner `compartilhado` por decisão com o ENSAVIM | Optótica e ENSAVIM | Somente arquivos/serviços designados e operações autorizadas; configuração real pendente |
| `G-OPT/GMAIL` | Projeto Optótica | Instrumento F15 em recurso de mensagens exclusivo, classe Pessoal | Optótica; envios ENSAVIM sob DM4 | Perfil/estado até CE14; envio versão final classe 3, destinatários/finalidade verificados |
| `G-PES` | Pessoa (Maestro) | Conta raiz **fora do escopo da Orquestra** | Nenhum, como raiz | Nunca contingência de escrita da G-OPT |
| `G-PES/ORQUESTRA` | Pessoa (Maestro), com cessão de contêiner ao Instituto | Contêiner `institucional_comum` de classe até Interno, **cessão proposta ainda não implementada** | Projetos ativos do Instituto quando necessário | Não compartilhar restante da conta nem correspondência pessoal |
| `G-ENS` | Ainda não definido | Conta alternativa futura, **não criada/habilitada** | Nenhum na configuração inicial | ENSAVIM usa apenas recursos designados em G-OPT conforme decisão |

**Atenção:** o nível `G-OPT/ENSAVIM-APOIO` é uma política a configurar; não presume que a pasta real exista. `G-PES/ORQUESTRA` exige autorização de cessão pelo titular, sem alterar a titularidade da conta.

## 3. Modelo de concessão por projeto

A elegibilidade da missão deve satisfazer:

1. E14a: projeto permitido para operador e instrumento;
2. E14b: recurso efetivo no nível mais específico com base `propria`, `institucional`, `compartilhamento`, `contrato` ou `concessao`;
3. classe e finalidade dos dados, RT-07 e política CE14;
4. autorização de operação, versão/hash, envelope, orçamento, rota ativa e ausência de pausa.

**Compartilhamento não é contingência de conta.** Alternativas para escrita precisam preservar o mesmo destino efetivo, não usar a conta de outro proprietário.

## 4. Serviços entre projetos (propostas, não habilitadas)

| Código lógico | Fornecedor | Consumidor | Capacidade | Condição |
| --- | --- | --- | --- | --- |
| `CC-OPT-01` | Optótica | ENSAVIM | Canva: criar/exportar via Portal | Contrato versionado, dados até Interno, conta/pasta do ENSAVIM e custo ao consumidor; **não configurado** |
| `CS-OPT-01` | Optótica | ENSAVIM | Conteúdo do contêiner institucional de apoio | Compartilhamento registrado, operações/prazo limitados; **não configurado** |

O projeto fornecedor não se torna instrumento F; utiliza recursos de serviço expostos pelas capacidades F já catalogadas.

## 5. Pendências explícitas da matriz

- Validar contas realmente conectadas aos hubs por **perfil/estado apenas**, sem conteúdo e sem persistir identificadores em repositório público.
- Ratificar os escopos marcados `a confirmar` para F1, F3, F6, F7, F9, e operadores de F4, F5, F8, F10, F11.
- Resolver relações assimétricas da Grade antes de criar laços `opera` operacionais; relações documentais não são grants.
- CE14, Gmail F15, DM6 e contratos de compartilhamento não estão implantados; nenhum instrumento recebe escrita nesta documentação.
