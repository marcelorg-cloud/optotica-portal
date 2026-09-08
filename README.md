# Optótica Portal

Aplicação Next.js do Portal Optótica, preparada para Vercel, Supabase e Meta WhatsApp Cloud API.

## Rotas

- `/`: apresentação do portal;
- `/entrar`: instrução de acesso do paciente e Magic Link profissional;
- `/cadastrar`: início do cadastro por e-mail exclusivamente para profissionais;
- `/cliente`: pedidos do cliente autenticado;
- `/profissional`: área profissional protegida;
- `/profissional/cadastro`: formulário profissional e de múltiplos laboratórios;
- `/profissional/pacientes/novo`: QR Code e link de paciente com validade de 24 horas;
- `/convite/[token]`: confirmação do convite no WhatsApp oficial;
- `/admin`: aprovação de profissionais pelo usuário master;
- `/api/webhooks/whatsapp`: verificação e eventos da Meta;
- `/api/auth/register`: cadastro profissional com confirmação por Magic Link;
- `/auth/confirm`: validação SSR dos Magic Links profissionais e dos links enviados pelo WhatsApp;
- `/auth/callback`: compatibilidade temporária com links PKCE antigos.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use Node.js 20.9 ou superior. Nunca grave chaves secretas no Git. A chave publicável do Supabase pode ser usada no navegador; `SUPABASE_SECRET_KEY`, `META_APP_SECRET` e `META_WHATSAPP_TOKEN` são exclusivamente do servidor.

## Banco e Storage

As migrações estendem, sem apagar, o esquema já existente no projeto `optotica-dev`:

- `202609020001_initial_schema.sql` preserva `organizations`, membros, perfis e os buckets existentes; acrescenta unidades, lentes, armações e escolhas de armação; completa as políticas de orçamentos, sequências e solicitações do WhatsApp; protege os buckets privados `client-documents` e `try-on-photos`.
- `202609070006_sync_missing_production_schema.sql` traz para o controle de versão o que foi aplicado direto em produção (nunca commitado antes) e acrescenta:
  - usuário `master_admin` sem cadastro público;
  - perfil profissional com estados `draft`, `under_review`, `changes_requested`, `approved`, `rejected` e `suspended`, com organização própria e isolada por profissional/ótica;
  - múltiplos laboratórios e catálogos bloqueados até aprovação;
  - convites de paciente com token aleatório armazenado somente como hash, validade de 24 horas e uso único;
  - vínculo criado apenas pelo webhook após o opt-in do número esperado no WhatsApp;
  - identidade de WhatsApp privada para localizar a conta sem varrer usuários do Auth;
  - políticas RLS que permitem ao profissional acessar somente pacientes vinculados à própria conta por um convite aceito; vínculos manuais ou legados não bastam;
  - Magic Link do paciente entregue somente ao WhatsApp confirmado, com validação adicional de 15 minutos e uso único no portal;
  - `audit_logs` com o registro de toda decisão do master (aprovação, rejeição, correção, suspensão, reativação).

Não habilite Google como provedor. Profissionais usam e-mail/Magic Link; pacientes não fazem cadastro livre e confirmam o número pelo WhatsApp.

### Criar o usuário master

1. Inicie e confirme uma conta profissional com o e-mail que será o administrador (via `/cadastrar`).
2. Abra `supabase/scripts/bootstrap-master.sql` no SQL Editor.
3. Substitua `SUBSTITUA_PELO_EMAIL_MASTER` pelo e-mail confirmado e execute.
4. Entre novamente pelo Magic Link. A conta será redirecionada para `/admin`.

O script falha de propósito enquanto o e-mail não for substituído e nunca promove automaticamente o primeiro usuário do banco.

Depois de aplicar a migração, rode `supabase/tests/verify_access_control.sql` (somente leitura) para conferir que todas as tabelas novas estão com `rowsecurity = true` e que as políticas esperadas existem.

Antes de aplicar no projeto remoto, execute a migração em uma branch ou projeto de teste e valide as políticas com usuários de cada perfil.

## Migração dos dados legados

O backup oficial do FTP de 2 de setembro de 2026 permanece a referência histórica. Os arquivos PHP na raiz ainda não participam do build Next.js.

`optotica-data/profiles.php` contém dados pessoais reais e permanece bloqueado pelo `.gitignore`. A exportação autorizada mantém somente os pedidos `#1287` e `#1288`; os outros 1.287 registros vazios são descartados:

```bash
node scripts/extract-valid-orders.js \
  optotica-data/profiles.php \
  migration-output/valid-orders.json
```

O JSON gerado também fica fora do Git e ainda precisa ser transformado para o esquema relacional antes da importação.

Valide a carga sem enviar dados:

```bash
node scripts/import-valid-orders.mjs migration-output/valid-orders.json
```

Depois de aplicar as extensões do esquema e configurar `OPTOTICA_ORGANIZATION_ID` e `OPTOTICA_PROFESSIONAL_ID`, execute conscientemente com `--apply`. A importação cria também o vínculo explícito entre o profissional e o paciente. A secret key do Supabase deve existir apenas no ambiente local seguro durante a migração.

## Publicação

1. Vincule este repositório à Vercel.
2. Cadastre as variáveis de `.env.example` nos ambientes Preview e Production.
3. Aplique e teste a migração no Supabase.
4. Cadastre `https://optotica-portal.vercel.app/auth/confirm`, `https://app.optotica.com.br/auth/confirm` e as URLs `/auth/callback` de compatibilidade nos Redirect URLs do Supabase.
5. Publique primeiro na URL provisória da Vercel.
6. Depois dos testes, vincule `app.optotica.com.br` e configure o webhook da Meta.
