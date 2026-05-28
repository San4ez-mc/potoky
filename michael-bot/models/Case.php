<?php
/**
 * Case model — кейси Олександра для підбору і відображення в адмін-панелі
 */

require_once APP_ROOT . '/db.php';

class CaseItem
{
    public static function getAll(): array
    {
        $pdo = db();
        return $pdo->query('SELECT * FROM cases ORDER BY category, id')->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function getActive(): array
    {
        $pdo = db();
        return $pdo->query('SELECT * FROM cases WHERE is_active = 1 ORDER BY category, id')->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function findById(int $id): ?array
    {
        $pdo = db();
        $stmt = $pdo->prepare('SELECT * FROM cases WHERE id = ? LIMIT 1');
        $stmt->execute([$id]);
        return $stmt->fetch(PDO::FETCH_ASSOC) ?: null;
    }

    /**
     * Get top N cases relevant to a business type (by keyword matching).
     */
    public static function getRelevant(string $businessType, int $limit = 3): array
    {
        $pdo = db();
        $stmt = $pdo->prepare(
            "SELECT *, 
             (CASE WHEN business_type = ? THEN 3 
                   WHEN keywords LIKE ? THEN 2
                   ELSE 1 END) AS relevance
             FROM cases
             WHERE is_active = 1
             ORDER BY relevance DESC, id ASC
             LIMIT ?"
        );
        $keyword = '%' . $businessType . '%';
        $stmt->execute([$businessType, $keyword, $limit]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    public static function create(array $data): int
    {
        $pdo = db();
        $stmt = $pdo->prepare(
            'INSERT INTO cases (category, title, business_type, keywords, problem, solution, result, hours_saved, money_saved, is_active)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        );
        $stmt->execute([
            $data['category'],
            $data['title'],
            $data['business_type'],
            $data['keywords'],
            $data['problem'],
            $data['solution'],
            $data['result'],
            $data['hours_saved'] ?? null,
            $data['money_saved'] ?? null,
            1
        ]);
        return (int) $pdo->lastInsertId();
    }

    public static function update(int $id, array $data): bool
    {
        $pdo = db();
        $allowed = ['category', 'title', 'business_type', 'keywords', 'problem', 'solution', 'result', 'hours_saved', 'money_saved', 'is_active'];
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
        $stmt = $pdo->prepare('UPDATE cases SET ' . implode(', ', $sets) . ' WHERE id = ?');
        return $stmt->execute($values);
    }

    public static function delete(int $id): bool
    {
        $pdo = db();
        $stmt = $pdo->prepare('DELETE FROM cases WHERE id = ?');
        return $stmt->execute([$id]);
    }
}
