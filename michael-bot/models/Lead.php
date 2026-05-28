<?php
/**
 * Lead model — CRUD для таблиці leads
 */

require_once APP_ROOT . '/db.php';

class Lead
{
    public static function findByTelegramId(int $telegramId): ?array
    {
        $pdo = db();
        $stmt = $pdo->prepare('SELECT * FROM leads WHERE telegram_id = ? LIMIT 1');
        $stmt->execute([$telegramId]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public static function findById(int $id): ?array
    {
        $pdo = db();
        $stmt = $pdo->prepare('SELECT * FROM leads WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    public static function create(int $telegramId, ?string $username, ?string $firstName): array
    {
        $pdo = db();
        $stmt = $pdo->prepare(
            'INSERT INTO leads (telegram_id, username, first_name, stage, last_message_at, created_at)
             VALUES (?, ?, ?, "new", NOW(), NOW())'
        );
        $stmt->execute([$telegramId, $username, $firstName]);
        $id = (int) $pdo->lastInsertId();
        return self::findById($id);
    }

    public static function update(int $id, array $data): bool
    {
        $pdo = db();
        $allowed = [
            'username',
            'first_name',
            'business_type',
            'pain_summary',
            'hours_lost',
            'money_lost',
            'matched_case_id',
            'stage',
            'followup_count',
            'last_message_at',
            'meeting_at',
            'fineko_task_id'
        ];

        $sets = [];
        $values = [];
        foreach ($data as $key => $value) {
            if (in_array($key, $allowed, true)) {
                $sets[] = "`$key` = ?";
                $values[] = $value;
            }
        }

        if (empty($sets))
            return false;

        $values[] = $id;
        $sql = 'UPDATE leads SET ' . implode(', ', $sets) . ' WHERE id = ?';
        $stmt = $pdo->prepare($sql);
        return $stmt->execute($values);
    }

    public static function updateStage(int $id, string $stage): bool
    {
        return self::update($id, ['stage' => $stage]);
    }

    public static function touchLastMessage(int $id): bool
    {
        $pdo = db();
        $stmt = $pdo->prepare('UPDATE leads SET last_message_at = NOW() WHERE id = ?');
        return $stmt->execute([$id]);
    }

    /**
     * Get leads due for follow-up.
     */
    public static function getFollowUpCandidates(): array
    {
        $pdo = db();
        $stmt = $pdo->query(
            "SELECT l.*, s.value AS delay
             FROM leads l
             JOIN settings s ON s.`key` = CONCAT('followup_delay_', l.followup_count + 1)
             WHERE l.stage NOT IN ('booked', 'rejected', 'archived')
               AND l.followup_count < 3
               AND TIMESTAMPDIFF(MINUTE, l.last_message_at, NOW()) >= CAST(s.value AS UNSIGNED)"
        );
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Get leads to archive (no activity for followup_delay_archive minutes after 3 follow-ups).
     */
    public static function getArchiveCandidates(): array
    {
        $pdo = db();
        $stmt = $pdo->query(
            "SELECT l.* FROM leads l
             JOIN settings s ON s.`key` = 'followup_delay_archive'
             WHERE l.stage NOT IN ('booked', 'rejected', 'archived')
               AND l.followup_count >= 3
               AND TIMESTAMPDIFF(MINUTE, l.last_message_at, NOW()) >= CAST(s.value AS UNSIGNED)"
        );
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function getAll(string $stage = '', string $search = '', int $page = 1, int $perPage = 20): array
    {
        $pdo = db();
        $where = '1=1';
        $params = [];

        if ($stage) {
            $where .= ' AND stage = ?';
            $params[] = $stage;
        }
        if ($search) {
            $where .= ' AND (first_name LIKE ? OR username LIKE ?)';
            $params[] = "%$search%";
            $params[] = "%$search%";
        }

        $offset = ($page - 1) * $perPage;
        $stmt = $pdo->prepare("SELECT * FROM leads WHERE $where ORDER BY created_at DESC LIMIT $perPage OFFSET $offset");
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $countStmt = $pdo->prepare("SELECT COUNT(*) FROM leads WHERE $where");
        $countStmt->execute($params);
        $total = (int) $countStmt->fetchColumn();

        return ['rows' => $rows, 'total' => $total, 'pages' => (int) ceil($total / $perPage)];
    }
}
