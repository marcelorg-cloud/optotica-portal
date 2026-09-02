# Optótica Portal

Aplicação Next.js do Portal Optótica, preparada para Vercel, Supabase e Meta WhatsApp Cloud API.

## Rotas

- `/`: apresentação do portal;
- `/entrar`: entrada do cliente por WhatsApp e Magic Link profissional;
- `/cliente`: pedidos do cliente autenticado;
- `/profissional`: área profissional protegida;
- `/api/webhooks/whatsapp`: verificação e eventos da Meta;
- `/auth/callback`: conclusão do Magic Link profissional;
- `/auth/confirm`: confirmação do link gerado pelo backend para WhatsApp.

## Desenvolvimento

```bash
npm install
cp .env.example .env.local
npm run dev
```

Use Node.js 20.9 ou superior. Nunca grave chaves secretas no Git. A chave publicável do Supabase pode ser usada no navegador; `SUPABASE_SECRET_KEY`, `META_APP_SECRET` e `META_WHATSAPP_TOKEN` são exclusivamente do servidor.

## Banco e Storage

A migração `supabase/migrations/202609020001_initial_schema.sql` cria:

- empresas, unidades, profissionais e permissões;
- clientes e consentimentos;
- pedidos, prescrições, orçamentos, lentes e armações;
- documentos e histórico de auditoria;
- políticas RLS multiempresa;
- bucket privado `patient-documents`.

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

Depois de aplicar o esquema e configurar `OPTOTICA_COMPANY_ID`, execute conscientemente com `--apply`. A secret key do Supabase deve existir apenas no ambiente local seguro durante a migração.

## Publicação

1. Vincule este repositório à Vercel.
2. Cadastre as variáveis de `.env.example` nos ambientes Preview e Production.
3. Aplique e teste a migração no Supabase.
4. Cadastre `https://app.optotica.com.br/auth/callback` nos Redirect URLs do Supabase.
5. Publique primeiro na URL provisória da Vercel.
6. Depois dos testes, vincule `app.optotica.com.br` e configure o webhook da Meta.
