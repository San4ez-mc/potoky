<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);

echo "Створення таблиці для промптів...\n\n";

try {
    // Таблиця для збереження промптів
    $db->query('
        CREATE TABLE IF NOT EXISTS image_prompts (
            id INT AUTO_INCREMENT PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            prompt_text TEXT NOT NULL,
            is_default TINYINT(1) NOT NULL DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    ');
    echo "✅ Таблиця image_prompts створена\n\n";

    // Додаємо дефолтні промпти
    $defaultPrompts = [
        ['Експертний портрет', 'professional female constellations facilitator, standing three-quarter pose, open palms gesture, calm confident smile, direct eye contact, modern therapy studio, soft natural window light, shallow depth of field, photorealistic'],
        ['Пояснення для блогу', 'expert systemic constellations coach, seated at table, explaining with expressive hand gesture, empathetic facial expression, notebook and cards nearby, warm cozy office, cinematic soft light, premium personal brand photo'],
        ['Робота з групою', 'female therapist leading a small workshop, dynamic side pose, hand gesture mid-speech, focused compassionate expression, blurred participants in background, bright training room, documentary editorial style, realistic photo'],
        ['Теплий довірливий кадр', 'close-up portrait of constellation practitioner, gentle smile, hand on heart gesture, attentive eyes, neutral minimal background, soft rim light, high-end magazine style, realistic skin texture'],
        ['Бізнес-експерт', 'business portrait of female constellations expert, straight posture, folded notes in hand, confident but friendly expression, elegant smart casual outfit, clean office interior, professional branding photography'],
        ['Casual lifestyle', 'lifestyle photo of expert mentor walking in bright studio, relaxed natural movement, one hand holding journal, light smile, airy interior, minimal modern design, natural daylight, photorealistic'],
        ['Артистичний настрій', 'artistic portrait of female therapist, dramatic side light, thoughtful gaze away from camera, subtle hand gesture, soft shadows, moody yet warm color grading, cinematic editorial aesthetic'],
        ['Польовий/виїзний кадр', 'outdoor portrait of systemic constellations facilitator, confident stance, expressive open-hand gesture, natural smile, urban park or terrace background, golden hour light, premium social media content photo']
    ];

    echo "Додаємо дефолтні промпти:\n";
    foreach ($defaultPrompts as $prompt) {
        $existing = $db->query('SELECT id FROM image_prompts WHERE name = ?', [$prompt[0]])->fetch();
        if (!$existing) {
            $db->query('INSERT INTO image_prompts (name, prompt_text, is_default) VALUES (?, ?, 1)', [$prompt[0], $prompt[1]]);
            echo "  ✅ {$prompt[0]}\n";
        } else {
            echo "  ⚠️  {$prompt[0]} (вже існує)\n";
        }
    }

    echo "\n✅ Готово! Промпти додано\n";

} catch (Exception $e) {
    echo "❌ Помилка: " . $e->getMessage() . "\n";
    exit(1);
}
