<?php
/**
 * ProcessLog model — для timeline в адмін-панелі
 */

require_once APP_ROOT . '/db.php';

class ProcessLog
{
    const EVENT_MSG_RECEIVED = 'msg_received';
    const EVENT_CLAUDE_CALLED = 'claude_called';
    const EVENT_CASE_MATCHED = 'case_matched';
    const EVENT_SLOTS_SHOWN = 'slots_shown';
    const EVENT_FINEKO_CREATED = 'fineko_created';
    const EVENT_NOTIFICATION = 'notification_sent';
    const EVENT_FOLLOWUP_SENT = 'followup_sent';
    const EVENT_STAGE_CHANGED = 'stage_changed';
    const EVENT_ERROR = 'error';

    public static function log(int $leadId, string $eventType, ?array $eventData = null, ?int $durationMs = null): int
    {
        $pdo = db();
        $stmt = $pdo->prepare(
            'INSERT INTO process_log (lead_id, event_type, event_data, duration_ms, created_at)
             VALUES (?, ?, ?, ?, NOW())'
        );
        $stmt->execute([
            $leadId,
            $eventType,
            $eventData ? json_encode($eventData, JSON_UNESCAPED_UNICODE) : null,
            $durationMs
        ]);
        return (int) $pdo->lastInsertId();
    }

    public static function getForLead(int $leadId): array
    {
        $pdo = db();
        $stmt = $pdo->prepare('SELECT * FROM process_log WHERE lead_id = ? ORDER BY created_at ASC');
        $stmt->execute([$leadId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$row) {
            if ($row['event_data']) {
                $row['event_data'] = json_decode($row['event_data'], true);
            }
        }
        return $rows;
    }
}
