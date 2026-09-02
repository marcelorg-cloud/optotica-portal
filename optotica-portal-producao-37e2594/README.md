# Optotica Portal

Fonte de produção preparada a partir do backup oficial do FTP de 2 de setembro de 2026.

## Conteúdo

- área profissional do optometrista;
- área do paciente;
- catálogo e cinco modelos;
- núcleo de autenticação, API e sincronização;
- webhook e manifesto.

As versões de `area-profissional-optotico/index.php`, `catalogo-optotico/index.php` e `optotica-core/professional-patient-sync.js` são exclusivamente as versões do FTP.

## Segurança

`optotica-data/profiles.php` contém dados pessoais reais e está bloqueado pelo `.gitignore`. Tokens, hashes de acesso e profissionais autorizados não ficam no código. Configure no ambiente de produção:

- `OPTOTICA_WEBHOOK_VERIFY_TOKEN`;
- `OPTOTICA_CLIENT_PASSWORD_SHA256`;
- `OPTOTICA_PRO_PASSWORD_SHA256`;
- `OPTOTICA_PROFESSIONALS_JSON`.

Nunca adicione ao Git arquivos de exportação presentes em `migration-output/`.

## Preparação dos pedidos para o Supabase

O cadastro original contém 1.289 entradas de pedidos. A migração autorizada preserva somente os pedidos `#1287` e `#1288`; os 1.287 registros vazios não são exportados.

Execute localmente, usando o arquivo real mantido fora do Git:

```bash
node scripts/extract-valid-orders.js \
  optotica-data/profiles.php \
  migration-output/valid-orders.json
```

O script interrompe a execução se não encontrar exatamente os pedidos `#1287` e `#1288`.
