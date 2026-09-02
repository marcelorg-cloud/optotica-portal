<?php
if (!defined('OPTOTICA_BOOTSTRAP')) {
    http_response_code(403);
    exit;
}

function optotica_patients_file() {
    // Hotfix V3.1: pacientes passam a usar o mesmo arquivo gravavel de perfis.
    // Os dados ficam isolados dentro da chave reservada __patients__.
    return optotica_profiles_file();
}

function optotica_patients_prefix() {
    return "<?php exit; ?>\n";
}

function optotica_normalize_patient_phone($value) {
    $digits = preg_replace('/\D+/', '', (string)$value);

    // ID oficial: DDD + telefone, sem +55.
    if ((strlen($digits) === 12 || strlen($digits) === 13) && substr($digits, 0, 2) === '55') {
        $digits = substr($digits, 2);
    }

    return $digits;
}

function optotica_valid_patient_phone($phone) {
    return (bool)preg_match('/^\d{10,11}$/', (string)$phone);
}

function optotica_read_patients() {
    $all = optotica_read_profiles();
    if (!is_array($all)) return array();
    return (isset($all['__patients__']) && is_array($all['__patients__']))
        ? $all['__patients__']
        : array();
}

function optotica_write_patients($patients) {
    $all = optotica_read_profiles();
    if (!is_array($all)) $all = array();
    $all['__patients__'] = is_array($patients) ? $patients : array();
    return optotica_write_profiles($all);
}

function optotica_empty_patient($phone) {
    $phone = optotica_normalize_patient_phone($phone);
    $now = gmdate('c');

    return array(
        'phone' => $phone,
        'customer' => array(
            'name' => '',
            'whatsapp' => $phone,
            'email' => '',
            'dnpOd' => '',
            'dnpOe' => '',
            'photo' => ''
        ),
        'professional' => array(
            'phone' => '',
            'name' => '',
            'registration' => '',
            'stamp' => '',
            'signature' => ''
        ),
        'orders' => array(),
        'createdAt' => $now,
        'updatedAt' => $now
    );
}

function optotica_get_or_create_patient($phone) {
    $phone = optotica_normalize_patient_phone($phone);
    if (!optotica_valid_patient_phone($phone)) return null;

    $patients = optotica_read_patients();

    if (!isset($patients[$phone]) || !is_array($patients[$phone])) {
        $patients[$phone] = optotica_empty_patient($phone);
        if (!optotica_write_patients($patients)) return null;
    }

    return $patients[$phone];
}

function optotica_save_patient($phone, $record) {
    $phone = optotica_normalize_patient_phone($phone);
    if (!optotica_valid_patient_phone($phone) || !is_array($record)) return false;

    $patients = optotica_read_patients();
    $old = isset($patients[$phone]) && is_array($patients[$phone])
        ? $patients[$phone]
        : optotica_empty_patient($phone);

    $record['phone'] = $phone;
    $record['createdAt'] = isset($old['createdAt']) ? $old['createdAt'] : gmdate('c');
    $record['updatedAt'] = gmdate('c');

    if (!isset($record['customer']) || !is_array($record['customer'])) {
        $record['customer'] = array();
    }
    $record['customer']['whatsapp'] = $phone;

    if (!isset($record['orders']) || !is_array($record['orders'])) {
        $record['orders'] = array();
    }

    $patients[$phone] = $record;
    return optotica_write_patients($patients);
}

function optotica_apply_client_patch($phone, $incoming) {
    $phone = optotica_normalize_patient_phone($phone);
    $record = optotica_get_or_create_patient($phone);

    if (!$record || !is_array($incoming)) return null;

    // O cliente só pode trocar a própria foto.
    if (isset($incoming['customer']) && is_array($incoming['customer']) &&
        array_key_exists('photo', $incoming['customer'])) {
        $record['customer']['photo'] = (string)$incoming['customer']['photo'];
    }

    // O cliente só pode fazer escolhas dentro de pedidos já criados pelo profissional.
    if (isset($incoming['orders']) && is_array($incoming['orders'])) {
        foreach ($incoming['orders'] as $number => $patch) {
            $number = preg_replace('/[^\dA-Za-z_-]/', '', (string)$number);
            if (!$number || !isset($record['orders'][$number]) || !is_array($patch)) continue;

            if (array_key_exists('selectedBudgetId', $patch)) {
                $record['orders'][$number]['selectedBudgetId'] = (string)$patch['selectedBudgetId'];
            }

            if (isset($patch['selectedFrame']) && is_array($patch['selectedFrame'])) {
                $f = $patch['selectedFrame'];
                $record['orders'][$number]['selectedFrame'] = array(
                    'name' => isset($f['name']) ? (string)$f['name'] : '',
                    'sku' => isset($f['sku']) ? (string)$f['sku'] : '',
                    'color' => isset($f['color']) ? (string)$f['color'] : '',
                    'origin' => isset($f['origin']) ? (string)$f['origin'] : ''
                );
            }
        }
    }

    if (!optotica_save_patient($phone, $record)) return null;
    return optotica_get_or_create_patient($phone);
}

function optotica_empty_order($number) {
    return array(
        'number' => (string)$number,
        'status' => 'em andamento',
        'prescription' => array(
            'od' => array('esf'=>'','cil'=>'','eixo'=>'','adicao'=>''),
            'oe' => array('esf'=>'','cil'=>'','eixo'=>'','adicao'=>'')
        ),
        'budgets' => array(),
        'selectedBudgetId' => '',
        'lensDraft' => array('type'=>'','index'=>'1.50','material'=>'Resina','treatment'=>'Antirreflexo','lab'=>''),
        'selectedFrame' => array('name'=>'','sku'=>'','color'=>'','origin'=>''),
        'finalValue' => '',
        'createdAt' => gmdate('c'),
        'updatedAt' => gmdate('c')
    );
}

function optotica_create_patient_order($phone) {
    $phone = optotica_normalize_patient_phone($phone);
    $record = optotica_get_or_create_patient($phone);
    if (!$record) return null;

    $max = 1286;
    if (isset($record['orders']) && is_array($record['orders'])) {
        foreach ($record['orders'] as $key => $order) {
            if (preg_match('/^\d+$/', (string)$key)) $max = max($max, intval($key));
            if (is_array($order) && isset($order['number']) && preg_match('/^\d+$/', (string)$order['number'])) {
                $max = max($max, intval($order['number']));
            }
        }
    } else {
        $record['orders'] = array();
    }

    $number = (string)($max + 1);
    $order = optotica_empty_order($number);
    $record['orders'][$number] = $order;
    if (!optotica_save_patient($phone, $record)) return null;

    return array('order'=>$order, 'record'=>optotica_get_or_create_patient($phone));
}
