<?php
if (!defined('OPTOTICA_BOOTSTRAP')) {
    http_response_code(403);
    exit;
}

function optotica_profiles_file() {
    return dirname(__DIR__) . '/optotica-data/profiles.php';
}

function optotica_profiles_prefix() {
    return "<?php exit; ?>\n";
}

function optotica_read_profiles() {
    $file = optotica_profiles_file();

    if (!file_exists($file)) {
        return array();
    }

    $raw = file_get_contents($file);
    if ($raw === false) {
        return array();
    }

    $prefix = optotica_profiles_prefix();
    if (strpos($raw, $prefix) === 0) {
        $raw = substr($raw, strlen($prefix));
    }

    $data = json_decode(trim($raw), true);
    return is_array($data) ? $data : array();
}

function optotica_write_profiles($profiles) {
    $file = optotica_profiles_file();
    $dir = dirname($file);

    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }

    $payload = optotica_profiles_prefix() .
        json_encode($profiles, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) .
        "\n";

    $fp = fopen($file, 'c+');
    if (!$fp) {
        return false;
    }

    $ok = false;

    if (flock($fp, LOCK_EX)) {
        ftruncate($fp, 0);
        rewind($fp);
        $written = fwrite($fp, $payload);
        fflush($fp);
        flock($fp, LOCK_UN);
        $ok = ($written !== false);
    }

    fclose($fp);
    return $ok;
}

function optotica_profile_id($role, $phone) {
    $prefix = ($role === 'professional') ? 'PRO' : 'CLI';
    return $prefix . '-' . substr(hash('sha256', $role . '|' . $phone), 0, 12);
}

function optotica_upsert_profile($phone, $role) {
    $phone = preg_replace('/\D+/', '', (string)$phone);
    $role = ($role === 'professional') ? 'professional' : 'client';

    if (!$phone) {
        return null;
    }

    $profiles = optotica_read_profiles();
    $key = $role . ':' . $phone;
    $now = gmdate('c');

    if (!isset($profiles[$key]) || !is_array($profiles[$key])) {
        $profiles[$key] = array(
            'profile_id' => optotica_profile_id($role, $phone),
            'phone' => $phone,
            'role' => $role,
            'status' => 'active',
            'created_at' => $now,
            'last_login_at' => $now
        );
    } else {
        $profiles[$key]['last_login_at'] = $now;
        $profiles[$key]['status'] = 'active';
    }

    if (!optotica_write_profiles($profiles)) {
        return null;
    }

    return $profiles[$key];
}

function optotica_get_profile($phone, $role) {
    $phone = preg_replace('/\D+/', '', (string)$phone);
    $profiles = optotica_read_profiles();
    $key = $role . ':' . $phone;

    return isset($profiles[$key]) && is_array($profiles[$key])
        ? $profiles[$key]
        : null;
}
