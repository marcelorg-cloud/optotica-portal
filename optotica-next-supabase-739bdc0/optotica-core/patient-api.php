<?php
define('OPTOTICA_BOOTSTRAP', true);
require_once __DIR__ . '/auth.php';
require_once __DIR__ . '/patient-store.php';

optotica_boot_session();
header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

function optotica_api_json($status, $payload) {
    http_response_code($status);
    echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

$role = optotica_current_role();
if ($role !== 'client' && $role !== 'professional') {
    optotica_api_json(401, array('ok'=>false,'error'=>'not_authenticated'));
}

$phone = $role === 'client'
    ? optotica_normalize_patient_phone(optotica_current_phone())
    : optotica_normalize_patient_phone(isset($_GET['phone']) ? $_GET['phone'] : '');

if (!optotica_valid_patient_phone($phone)) {
    optotica_api_json(400, array('ok'=>false,'error'=>'invalid_phone'));
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    $record = optotica_get_or_create_patient($phone);
    if (!$record) optotica_api_json(500, array('ok'=>false,'error'=>'storage_error'));
    optotica_api_json(200, array('ok'=>true,'phone'=>$phone,'record'=>$record));
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $incoming = json_decode(file_get_contents('php://input'), true);
    if (!is_array($incoming)) optotica_api_json(400, array('ok'=>false,'error'=>'invalid_json'));

    if ($role === 'professional' && isset($incoming['action']) && $incoming['action'] === 'create_order') {
        $created = optotica_create_patient_order($phone);
        if (!$created) optotica_api_json(500, array('ok'=>false,'error'=>'storage_error'));
        optotica_api_json(200, array('ok'=>true,'phone'=>$phone,'order'=>$created['order'],'record'=>$created['record']));
    }

    $record = isset($incoming['record']) && is_array($incoming['record']) ? $incoming['record'] : $incoming;

    if ($role === 'professional') {
        if (!isset($record['professional']) || !is_array($record['professional'])) $record['professional'] = array();
        $record['professional']['phone'] = optotica_current_phone();
        $record['professional']['name'] = isset($_SESSION['optotica_professional_name']) ? $_SESSION['optotica_professional_name'] : 'Profissional';

        if (!optotica_save_patient($phone, $record)) optotica_api_json(500, array('ok'=>false,'error'=>'storage_error'));
        optotica_api_json(200, array('ok'=>true,'phone'=>$phone,'record'=>optotica_get_or_create_patient($phone)));
    }

    $saved = optotica_apply_client_patch($phone, $record);
    if (!$saved) optotica_api_json(500, array('ok'=>false,'error'=>'storage_error'));
    optotica_api_json(200, array('ok'=>true,'phone'=>$phone,'record'=>$saved));
}

optotica_api_json(405, array('ok'=>false,'error'=>'method_not_allowed'));
