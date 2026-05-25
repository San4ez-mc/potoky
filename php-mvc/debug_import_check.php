<?php
require __DIR__ . '/app/core/Database.php';
$config = require __DIR__ . '/config/database.php';
$db = new Database($config);

$rows = $db->query(
    'SELECT sn.id, sn.name, COUNT(c.id) AS cnt
     FROM social_networks sn
     LEFT JOIN categories c ON c.social_network_id = sn.id
     GROUP BY sn.id, sn.name
     ORDER BY sn.id'
)->fetchAll(PDO::FETCH_ASSOC);

echo "Networks and category counts:\n";
foreach ($rows as $row) {
    echo sprintf("%d | %s | categories=%d\n", (int) $row['id'], $row['name'], (int) $row['cnt']);
}

echo "\nCategory names by network:\n";
$cats = $db->query('SELECT social_network_id, name FROM categories ORDER BY social_network_id, sort_order, id')->fetchAll(PDO::FETCH_ASSOC);
$current = null;
foreach ($cats as $cat) {
    if ($current !== (int) $cat['social_network_id']) {
        $current = (int) $cat['social_network_id'];
        echo "\nNetwork ID {$current}:\n";
    }
    echo " - {$cat['name']}\n";
}
