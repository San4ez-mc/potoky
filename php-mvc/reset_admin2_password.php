<?php
$config = require __DIR__ . '/config/database.php';
require __DIR__ . '/app/core/Database.php';

$db = new Database($config);
$row = $db->query('SELECT id, username FROM admin WHERE id = ?', [2])->fetch(PDO::FETCH_ASSOC);

if (!$row) {
    fwrite(STDERR, "NOT_FOUND\n");
    exit(2);
}

$newPassword = 'Adm2!' . bin2hex(random_bytes(4));
$hash = password_hash($newPassword, PASSWORD_DEFAULT);
$db->query('UPDATE admin SET password_hash = ? WHERE id = ?', [$hash, 2]);

echo "UPDATED\n";
echo 'id=' . $row['id'] . "\n";
echo 'username=' . $row['username'] . "\n";
echo 'password=' . $newPassword . "\n";
