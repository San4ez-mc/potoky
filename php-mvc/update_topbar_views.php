<?php
/**
 * Скрипт для масового оновлення topbar у views
 */

$viewsDir = __DIR__ . '/app/views';
$backupDir = __DIR__ . '/backups/views_' . date('Y-m-d_His');

// Створюємо бекап
if (!is_dir($backupDir)) {
    mkdir($backupDir, 0777, true);
}

$filesToUpdate = [
    'social-network-edit.php',
    'settings.php',
    'images.php',
    'accounts_new.php'
];

$oldTopbar = '    <div class="topbar">
        <div class="logo">📋 Content Planner Bot</div>
        <div class="menu">
            <a href="/">Контент план</a>
            <a href="/social-networks">Соц.мережі</a>
            <a href="/images">Зображення</a>
            <a href="/settings">Налаштування</a>
        </div>
        <a href="/logout" class="logout-link">🚪 Вийти</a>
    </div>';

$newTopbar = '    <?php require __DIR__ . \'/components/topbar.php\'; ?>';

foreach ($filesToUpdate as $filename) {
    $filePath = $viewsDir . '/' . $filename;
    
    if (!file_exists($filePath)) {
        echo "⚠️  Файл не знайдено: {$filename}\n";
        continue;
    }
    
    // Бекап
    copy($filePath, $backupDir . '/' . $filename);
    
    $content = file_get_contents($filePath);
    $updated = str_replace($oldTopbar, $newTopbar, $content);
    
    if ($content !== $updated) {
        file_put_contents($filePath, $updated);
        echo "✅ Оновлено: {$filename}\n";
    } else {
        echo "⚠️  Без змін: {$filename}\n";
    }
}

echo "\n✅ Бекап збережено в: {$backupDir}\n";
echo "✅ Оновлення topbar завершено!\n";
