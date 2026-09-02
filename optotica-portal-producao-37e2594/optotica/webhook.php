<?php

header('Content-Type: text/plain; charset=utf-8');

$verifyToken = getenv('OPTOTICA_WEBHOOK_VERIFY_TOKEN');

if ($verifyToken === false || $verifyToken === '') {
    error_log('OPTOTICA_WEBHOOK_VERIFY_TOKEN is not configured');
    http_response_code(503);
    echo 'WEBHOOK_NOT_CONFIGURED';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {

    $mode      = isset($_GET['hub_mode']) ? $_GET['hub_mode'] : '';
    $token     = isset($_GET['hub_verify_token']) ? $_GET['hub_verify_token'] : '';
    $challenge = isset($_GET['hub_challenge']) ? $_GET['hub_challenge'] : '';

    if ($mode === 'subscribe' && hash_equals($verifyToken, $token)) {
        http_response_code(200);
        echo $challenge;
        exit;
    }

    if ($mode !== '') {
        http_response_code(403);
        echo 'INVALID_VERIFY_TOKEN';
        exit;
    }

    http_response_code(200);
    echo 'OPTOTICA WEBHOOK OK';
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {

    // Nesta primeira etapa apenas confirmamos o recebimento.
    // A resposta automática do WhatsApp será adicionada depois.
    $payload = file_get_contents('php://input');

    http_response_code(200);
    echo 'EVENT_RECEIVED';
    exit;
}

http_response_code(405);
echo 'METHOD_NOT_ALLOWED';
