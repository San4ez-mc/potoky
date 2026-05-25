<?php
$config = require __DIR__ . '/config/database.php';
require_once __DIR__ . '/app/core/Database.php';

$db = new Database($config);

echo "Оновлення дефолтних промптів...\n\n";

try {
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

    $db->query('UPDATE image_prompts SET is_default = 0 WHERE is_default = 1');

    foreach ($defaultPrompts as $prompt) {
        $existing = $db->query('SELECT id FROM image_prompts WHERE name = ? LIMIT 1', [$prompt[0]])->fetch(PDO::FETCH_ASSOC);
        if ($existing) {
            $db->query('UPDATE image_prompts SET prompt_text = ?, is_default = 1 WHERE id = ?', [$prompt[1], (int) $existing['id']]);
            echo "✅ Оновлено: {$prompt[0]}\n";
        } else {
            $db->query('INSERT INTO image_prompts (name, prompt_text, is_default) VALUES (?, ?, 1)', [$prompt[0], $prompt[1]]);
            echo "✅ Додано: {$prompt[0]}\n";
        }
    }

    echo "\n✅ Готово! Дефолтні промпти оновлено.\n";
} catch (Exception $e) {
    echo "❌ Помилка: " . $e->getMessage() . "\n";
    exit(1);
}
