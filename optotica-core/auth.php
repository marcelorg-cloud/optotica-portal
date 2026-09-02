<?php
if (!defined('OPTOTICA_BOOTSTRAP')) {
    define('OPTOTICA_BOOTSTRAP', true);
}
require_once __DIR__ . '/config.php';
require_once __DIR__ . '/profiles.php';

function optotica_boot_session() {
    header('X-Robots-Tag: noindex, nofollow, noarchive, nosnippet', true);
    header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0', true);
    header('Pragma: no-cache', true);

    if (session_status() !== PHP_SESSION_ACTIVE) {
        $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
        session_set_cookie_params(0, '/', '', $secure, true);
        session_name('OPTOTICA_TESTE');
        session_start();
    }

    if (isset($_GET['sair'])) {
        $_SESSION = array();
        if (ini_get('session.use_cookies')) {
            $params = session_get_cookie_params();
            setcookie(session_name(), '', time() - 42000, $params['path'], $params['domain'], $params['secure'], $params['httponly']);
        }
        session_destroy();
        $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
        header('Location: ' . $path);
        exit;
    }
}

/*
 * ID oficial do paciente/profissional: DDD + telefone, somente digitos, sem 55.
 * Aceita digitacao com mascara e tambem +55 vindo do preenchimento automatico.
 */
function optotica_normalize_phone($value) {
    $digits = preg_replace('/\D+/', '', (string)$value);
    if ((strlen($digits) === 12 || strlen($digits) === 13) && substr($digits, 0, 2) === '55') {
        $digits = substr($digits, 2);
    }
    return $digits;
}

function optotica_valid_br_phone($phone) {
    return (bool)preg_match('/^\d{10,11}$/', (string)$phone);
}

function optotica_current_role() {
    return isset($_SESSION['optotica_role']) ? $_SESSION['optotica_role'] : null;
}

function optotica_current_phone() {
    return isset($_SESSION['optotica_phone']) ? $_SESSION['optotica_phone'] : null;
}

function optotica_is_client() { return optotica_current_role() === 'client'; }
function optotica_is_professional() { return optotica_current_role() === 'professional'; }

function optotica_set_identity($phone, $role, $profile, $extra = array()) {
    session_regenerate_id(true);
    unset($_SESSION['optotica_role'], $_SESSION['optotica_phone'], $_SESSION['optotica_profile_id'], $_SESSION['optotica_professional_name']);
    $_SESSION['optotica_role'] = $role;
    $_SESSION['optotica_phone'] = $phone;
    $_SESSION['optotica_profile_id'] = $profile['profile_id'];
    foreach ($extra as $key => $value) {
        $_SESSION[$key] = $value;
    }
}

function optotica_require_client_login() {
    global $OPTOTICA_CLIENT_PASSWORD_SHA256;
    optotica_boot_session();
    if (optotica_is_client()) return;

    $error = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['optotica_client_login'])) {
        $phone = optotica_normalize_phone(isset($_POST['telefone']) ? $_POST['telefone'] : '');
        $password = isset($_POST['senha']) ? (string)$_POST['senha'] : '';
        $passwordHash = hash('sha256', $password);

        if (optotica_valid_br_phone($phone) && hash_equals(strtolower($OPTOTICA_CLIENT_PASSWORD_SHA256), strtolower($passwordHash))) {
            $profile = optotica_upsert_profile($phone, 'client');
            if (!$profile) {
                $error = 'Não foi possível criar ou atualizar o perfil neste momento.';
            } else {
                optotica_set_identity($phone, 'client', $profile);
                $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
                header('Location: ' . $path);
                exit;
            }
        }
        if (!$error) $error = 'WhatsApp ou senha inválidos.';
    }

    http_response_code(401);
    optotica_render_login('Área do cliente', 'Seu número de WhatsApp com DDD é o seu ID no Portal Optótica.', 'client', $error);
    exit;
}

function optotica_require_professional_login() {
    global $OPTOTICA_PRO_PASSWORD_SHA256, $OPTOTICA_PROFESSIONALS;
    optotica_boot_session();
    if (optotica_is_professional()) return;

    $error = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['optotica_pro_login'])) {
        $phone = optotica_normalize_phone(isset($_POST['telefone']) ? $_POST['telefone'] : '');
        $password = isset($_POST['senha']) ? (string)$_POST['senha'] : '';
        $passwordHash = hash('sha256', $password);

        $authorized = optotica_valid_br_phone($phone)
            && isset($OPTOTICA_PROFESSIONALS[$phone])
            && !empty($OPTOTICA_PROFESSIONALS[$phone]['active']);

        if ($authorized && hash_equals(strtolower($OPTOTICA_PRO_PASSWORD_SHA256), strtolower($passwordHash))) {
            $profile = optotica_upsert_profile($phone, 'professional');
            if (!$profile) {
                $profile = array(
                    'profile_id' => optotica_profile_id('professional', $phone),
                    'phone' => $phone,
                    'role' => 'professional',
                    'status' => 'active'
                );
            }
            $name = isset($OPTOTICA_PROFESSIONALS[$phone]['name']) ? $OPTOTICA_PROFESSIONALS[$phone]['name'] : 'Profissional';
            optotica_set_identity($phone, 'professional', $profile, array('optotica_professional_name' => $name));
            $path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
            header('Location: ' . $path);
            exit;
        }
        if (!$error) $error = 'WhatsApp profissional não autorizado ou senha inválida.';
    }

    http_response_code(401);
    optotica_render_login('Área profissional', 'Entre com o WhatsApp profissional autorizado. Aceita DDD + número ou +55.', 'professional', $error);
    exit;
}

function optotica_require_any_login() {
    optotica_boot_session();
    if (optotica_is_client() || optotica_is_professional()) return;
    header('Location: /catalogo-optotico/');
    exit;
}

function optotica_render_login($title, $subtitle, $type, $error = '') {
    $action = htmlspecialchars(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), ENT_QUOTES, 'UTF-8');
    $hiddenName = $type === 'professional' ? 'optotica_pro_login' : 'optotica_client_login';
    $kind = $type === 'professional' ? 'Acesso profissional' : 'Acesso do cliente';
    ?>
<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow,noarchive,nosnippet">
<title>Optótica — <?php echo htmlspecialchars($title, ENT_QUOTES, 'UTF-8'); ?></title>
<style>
:root{--bg:#f5f5f3;--surface:#fff;--text:#171717;--muted:#6d6d67;--line:#deded8;--soft:#efefea;--danger:#9a3636}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:20px;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif}
.login{width:min(460px,100%)}.brand{font-size:28px;font-weight:800;letter-spacing:-.055em;margin:0 0 34px}.card{background:var(--surface);border:1px solid var(--line);border-radius:20px;padding:28px;box-shadow:0 10px 36px rgba(0,0,0,.055)}
.eyebrow{margin:0 0 7px;color:var(--muted);font-size:10px;font-weight:850;text-transform:uppercase;letter-spacing:.09em}h1{margin:0;font-size:34px;line-height:1.04;letter-spacing:-.04em}p{margin:10px 0 23px;color:var(--muted);font-size:12px;line-height:1.55}
label{display:block;margin:14px 0 6px;font-size:11px;font-weight:800}input{width:100%;height:50px;border:1px solid var(--line);border-radius:12px;background:#fff;padding:0 13px;font:inherit;outline:none}input:focus{border-color:#777;box-shadow:0 0 0 3px rgba(0,0,0,.04)}
button{width:100%;height:52px;margin-top:20px;border:0;border-radius:12px;background:#171717;color:#fff;font:inherit;font-weight:850;cursor:pointer}.err{margin:0 0 14px;padding:11px 12px;border-radius:11px;background:#fff1f1;color:var(--danger);font-size:11px}.meta{margin-top:15px;color:#92928b;font-size:10px;text-align:center}.idnote{margin-top:9px;padding:10px 11px;border:1px solid var(--line);border-radius:10px;background:#fafaf8;color:#66665f;font-size:10px}
</style>
</head>
<body>
<main class="login">
  <div class="brand">Optótica</div>
  <section class="card">
    <div class="eyebrow">Portal privado · <?php echo htmlspecialchars($kind, ENT_QUOTES, 'UTF-8'); ?></div>
    <h1><?php echo htmlspecialchars($title, ENT_QUOTES, 'UTF-8'); ?></h1>
    <p><?php echo htmlspecialchars($subtitle, ENT_QUOTES, 'UTF-8'); ?></p>
    <?php if ($error): ?><div class="err"><?php echo htmlspecialchars($error, ENT_QUOTES, 'UTF-8'); ?></div><?php endif; ?>
    <form method="post" action="<?php echo $action; ?>" autocomplete="on">
      <input type="hidden" name="<?php echo $hiddenName; ?>" value="1">
      <label for="telefone">WhatsApp com DDD</label>
      <input id="telefone" name="telefone" type="tel" inputmode="tel" placeholder="(44) 99999-9999" required autocomplete="username">
      <div class="idnote">O sistema normaliza automaticamente máscara e +55. O ID salvo fica somente DDD + número.</div>
      <label for="senha">Senha</label>
      <input id="senha" name="senha" type="password" required autocomplete="current-password">
      <button type="submit">ENTRAR</button>
    </form>
    <div class="meta">Ambiente de teste · acesso não público</div>
  </section>
</main>
</body>
</html>
<?php
}
