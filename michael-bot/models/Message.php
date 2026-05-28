<?php
/**
 * Message model
 */

require_once APP_ROOT . '/db.php';

class Message
{
    public static function save(int $leadId, string $role, string $content, string $stageAtSend = '', ?string $apiCallId = null): int
    {
        $pdo = db();
        $stmt = $pdo->prepare(
            'INSERT INTO messages (lead_id, role, content, stage_at_send, api_call_id, created_at)
             VALUES (?, ?, ?, ?, ?, NOW())'
        );
        $stmt->execute([$leadId, $role, $content, $stageAtSend, $apiCallId]);
        return (int) $pdo->lastInsertId();
    }

    public static function getHistory(int $leadId): array
    {
        $pdo = db();
        $stmt = $pdo->prepare('SELECT * FROM messages WHERE lead_id = ? ORDER BY created_at ASC');
        $stmt->execute([$leadId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function getForLead(int $leadId): array
    {
        return self::getHistory($leadId);
    }
}
