<?php
/*
 * OPTOTICA — CONFIGURAÇÃO DE ACESSO
 *
 * Credenciais e profissionais autorizados são configurados exclusivamente
 * por variáveis de ambiente no servidor de produção.
 */
if (!defined('OPTOTICA_CORE')) {
    http_response_code(403);
    exit;
}

$OPTOTICA_CLIENT_PASSWORD_SHA256 = getenv('OPTOTICA_CLIENT_PASSWORD_SHA256');
$OPTOTICA_PRO_PASSWORD_SHA256 = getenv('OPTOTICA_PRO_PASSWORD_SHA256');
$professionalsJson = getenv('OPTOTICA_PROFESSIONALS_JSON');
$OPTOTICA_PROFESSIONALS = array();

if (is_string($professionalsJson) && $professionalsJson !== '') {
    $decodedProfessionals = json_decode($professionalsJson, true);
    if (is_array($decodedProfessionals)) {
        $OPTOTICA_PROFESSIONALS = $decodedProfessionals;
    }
}

if (!is_string($OPTOTICA_CLIENT_PASSWORD_SHA256)) {
    $OPTOTICA_CLIENT_PASSWORD_SHA256 = '';
}

if (!is_string($OPTOTICA_PRO_PASSWORD_SHA256)) {
    $OPTOTICA_PRO_PASSWORD_SHA256 = '';
}
