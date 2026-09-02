<?php
define('OPTOTICA_BOOTSTRAP', true);
require_once dirname(__DIR__) . '/optotica-core/auth.php';
require_once dirname(__DIR__) . '/optotica-core/patient-store.php';

optotica_require_client_login();

$phone = optotica_normalize_patient_phone(optotica_current_phone());
$record = optotica_get_or_create_patient($phone);

if (!$record) {
    http_response_code(500);
    exit('Não foi possível abrir o perfil do paciente.');
}

$templateFile = __DIR__ . '/template.html';
if (!file_exists($templateFile)) {
    http_response_code(500);
    exit('Template da Área do Paciente não encontrado.');
}

$html = file_get_contents($templateFile);

$jsPhone = json_encode($phone, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
$jsRecord = json_encode($record, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);

/*
 * O HTML original usa o parâmetro telefone e localStorage.
 * Antes do JS original rodar, fixamos o telefone da SESSÃO e carregamos no
 * cache local o registro oficial vindo do servidor.
 */
$cachePhone = (strlen($phone) === 11) ? ('55' . $phone) : $phone;
$storageKey = 'optotica_cliente_phone_' . $cachePhone;
$jsStorageKey = json_encode($storageKey);

$bootstrap = <<<HTML
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
<script>
(function(){
  const serverPhone={$jsPhone};
  const serverRecord={$jsRecord};
  const u=new URL(location.href);
  u.searchParams.set('telefone',serverPhone);
  history.replaceState(null,'',u.pathname+'?'+u.searchParams.toString()+u.hash);
  try{
    localStorage.setItem({$jsStorageKey},JSON.stringify(serverRecord));
  }catch(e){}
})();
</script>
HTML;

/*
 * O HTML original continua usando saveRecord().
 * Depois dele carregar, trocamos apenas a função de gravação:
 * mantém cache local para a interface e envia a alteração ao servidor.
 * A API aplica as permissões do cliente.
 */
$sync = <<<HTML
<script>
(function(){
  if(typeof saveRecord!=='function') return;

  const originalSaveRecord=saveRecord;

  saveRecord=function(updatedRecord){
    originalSaveRecord(updatedRecord);

    fetch('/optotica-core/patient-api.php',{
      method:'POST',
      credentials:'same-origin',
      headers:{'Content-Type':'application/json','Accept':'application/json'},
      body:JSON.stringify({record:updatedRecord})
    })
    .then(r=>r.json())
    .then(data=>{
      if(data && data.ok && data.record){
        try{
          localStorage.setItem({$jsStorageKey},JSON.stringify(data.record));
        }catch(e){}
      }
    })
    .catch(()=>{});
  };
})();
</script>
HTML;

$html = str_replace('</head>', $bootstrap . "\n</head>", $html);
$html = str_replace('</body>', $sync . "\n</body>", $html);

header('X-Robots-Tag: noindex, nofollow, noarchive, nosnippet', true);
header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0', true);
echo $html;
