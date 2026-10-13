"use strict";
module.exports={
 release:"operational-gateway-v1",testCount:111,
 databaseChecks:"PostgreSQL isolado: chave, Master, escopo, custo conhecido, teto compartilhado, idempotência, reconexão, mudança de recurso, dispatch único, reserva incerta e emergência.",
 migrationNames:["regente10_operational_gateway","regente10_gateway_verification_receipts","regente10_gateway_identity_status"],
 custody:"Chaves Composio e Gateway apenas no servidor; Connect Links cifrados em repouso; nenhum service_role no runtime.",
 deploymentChecks:"Painel servido após validação de Master ativo; rotas públicas limitadas a login, sessão e retorno OAuth sem dados.",
 remainingProof:"Primeira execução real exige conta verificada e envelope S00 com tarifa e teto conhecidos. Apenas resultado com log_id comprova execução.",
 legacyFindings:[
  {name:"Funções antigas fora do Regente: revisar permissões de execução",url:"https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable"},
  {name:"Duas funções antigas com search_path mutável",url:"https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable"},
  {name:"Proteção de senhas comprometidas ainda desabilitada",url:"https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection"}
 ],
 limits:"Recursos pessoais/sensíveis e privilégio sem aprovação permanecem bloqueados. DM6 física planejada. Não há prova de faturamento do fornecedor nem autorização ilimitada."
};
