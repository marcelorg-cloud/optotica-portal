# Painel restrito ao Master

As páginas do Regente são entregues por GET /api/panel, após validação remota
em Supabase Auth /auth/v1/user e consulta de system_admins com active=true
para o ID autenticado. Não é usada user_metadata para conceder privilégio.

Somente login.html e session-client.js integram a saída pública gerada pelo
build. Os templates index, network, governance e budget entram apenas no
bundle da função panel, via includeFiles; não existe fallback estático público.
As rotas com e sem .html, raiz e index-operacional passam pela mesma função.

POST /api/session troca o Bearer da sessão Master validada por cookie
__Host-regente10_master, Secure, HttpOnly, SameSite=Strict, Path=/, sem Domain.
O tempo do cookie respeita exp do token verificado, limitado a uma hora.
POST e DELETE exigem Origin igual ao host HTTPS da aplicação. DELETE elimina
o cookie de acesso ao painel. O cliente elimina os tokens locais e retorna
para login; ao voltar pelo histórico, recarrega para revalidar no servidor.

As APIs existentes continuam exigindo Bearer e suas próprias autorizações.
O HTML autorizado inicializa o token da sessão do próprio usuário no
sessionStorage para manter essas APIs compatíveis, com Cache-Control privado
no-store. Refresh da sessão atualiza também o cookie por POST /api/session.
Nenhuma chave Composio, service role ou credencial de instrumento é enviada
ao navegador. Não há mudança de schema, RLS, usuários ou privilégios.

Ensaios: anônimo, Bearer sem cookie, não-Master, sessão inválida, autoridade
indisponível, Master ativo, travessia de caminho, origem externa, logout,
cookie duplicado e saída estática contendo apenas os dois arquivos públicos.
Login real do operador continua necessário para validação autenticada completa.
