# Regente 1.0 — Protótipo independente

Esta pasta contém o protótipo HTML interativo da interface Regente 1.0, com dados fictícios.

## Implantação em endereço separado

Crie **um novo projeto** Vercel denominado `regente-1-0`, usando o repositório `marcelorg-cloud/optotica-portal` e a branch `feat/regente-1-0-standalone`. Selecione o diretório raiz **`regente-1.0-preview`**, framework **Other / nenhum**, sem build e com saída estática do próprio diretório. Configure o novo projeto com domínio próprio separado (por exemplo o domínio padrão que a Vercel atribuir). **Não alterar os projetos existentes `optotica-regente` e `optotica-portal`.**

## Limites

- Interface somente demonstrativa (HTML/CSS/JS). Não há backend real, agentes em operação, credenciais, orçamento real, dados clínicos ou permissões executáveis.
- O botão de autorização e os fluxos são simulações locais; não representam a ativação do Regente 1.0.
- A aplicação antiga deve permanecer independente e funcionando.
- O GitHub e Vercel produtivos da Optótica devem ser tratados em fluxo próprio com testes, diffs e PRs. Não mesclar branches experimentais automaticamente.

## Estado

Preparado para implantação. Criação do novo projeto Vercel bloqueada pelo token conectado (403, escopo `admin-26358549`). Não foi publicado em endereço novo neste fluxo.
