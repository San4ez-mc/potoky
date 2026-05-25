<?php

class McpServer
{
    private $db;
    private $config;
    private $columnsCache = [];
    private $generationService;

    public function __construct($db, array $config = [])
    {
        $this->db = $db;
        $this->config = $config;

        require_once __DIR__ . '/MediaGenerationService.php';
        $this->generationService = new MediaGenerationService($db, $config);
    }

    public function handle()
    {
        $this->applyCors();

        if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
            http_response_code(204);
            return;
        }

        if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
            $this->jsonResponse([
                'name' => 'content-planner-mcp',
                'status' => 'ok',
                'message' => 'Use POST JSON-RPC requests for initialize/tools/list/tools/call',
            ]);
            return;
        }

        if (!$this->authorize()) {
            $this->jsonRpcError(null, -32001, 'Unauthorized: invalid or missing MCP token');
            return;
        }

        $payload = json_decode(file_get_contents('php://input'), true);
        if (!is_array($payload)) {
            $this->jsonRpcError(null, -32700, 'Parse error: invalid JSON');
            return;
        }

        $id = array_key_exists('id', $payload) ? $payload['id'] : null;
        $method = (string) ($payload['method'] ?? '');
        $params = isset($payload['params']) && is_array($payload['params']) ? $payload['params'] : [];

        try {
            if ($method === 'initialize') {
                $this->jsonRpcResult($id, [
                    'protocolVersion' => '2025-03-26',
                    'capabilities' => [
                        'tools' => (object) [],
                    ],
                    'serverInfo' => [
                        'name' => 'content-planner-mcp',
                        'version' => '1.0.0',
                    ],
                ]);
                return;
            }

            if ($method === 'notifications/initialized') {
                http_response_code(204);
                return;
            }

            if ($method === 'ping') {
                $this->jsonRpcResult($id, ['ok' => true]);
                return;
            }

            if ($method === 'tools/list') {
                $this->jsonRpcResult($id, [
                    'tools' => $this->getTools(),
                ]);
                return;
            }

            if ($method === 'tools/call') {
                $toolName = (string) ($params['name'] ?? '');
                $arguments = isset($params['arguments']) && is_array($params['arguments']) ? $params['arguments'] : [];
                $toolResult = $this->callTool($toolName, $arguments);

                $this->jsonRpcResult($id, [
                    'content' => [
                        [
                            'type' => 'text',
                            'text' => json_encode($toolResult, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT),
                        ],
                    ],
                    'isError' => false,
                ]);
                return;
            }

            $this->jsonRpcError($id, -32601, 'Method not found: ' . $method);
        } catch (InvalidArgumentException $e) {
            $this->jsonRpcResult($id, [
                'content' => [
                    [
                        'type' => 'text',
                        'text' => json_encode(['ok' => false, 'error' => $e->getMessage()], JSON_UNESCAPED_UNICODE),
                    ],
                ],
                'isError' => true,
            ]);
        } catch (Exception $e) {
            $this->jsonRpcResult($id, [
                'content' => [
                    [
                        'type' => 'text',
                        'text' => json_encode(['ok' => false, 'error' => 'internal_error', 'message' => $e->getMessage()], JSON_UNESCAPED_UNICODE),
                    ],
                ],
                'isError' => true,
            ]);
        }
    }

    private function getTools()
    {
        return [
            [
                'name' => 'list_projects',
                'description' => 'List all active projects.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'list_social_networks',
                'description' => 'List social networks.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'include_disabled' => ['type' => 'boolean'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'create_social_network',
                'description' => 'Create social network.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['name'],
                    'properties' => [
                        'name' => ['type' => 'string'],
                        'prompt' => ['type' => 'string'],
                        'is_enabled' => ['type' => 'boolean'],
                        'sort_order' => ['type' => 'integer'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'update_social_network',
                'description' => 'Update social network fields.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['network_id'],
                    'properties' => [
                        'network_id' => ['type' => 'integer'],
                        'name' => ['type' => 'string'],
                        'prompt' => ['type' => 'string'],
                        'is_enabled' => ['type' => 'boolean'],
                        'sort_order' => ['type' => 'integer'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'delete_social_network',
                'description' => 'Delete social network by ID.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['network_id'],
                    'properties' => [
                        'network_id' => ['type' => 'integer'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'list_categories',
                'description' => 'List categories for project with optional social network filter.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['project_id'],
                    'properties' => [
                        'project_id' => ['type' => 'integer'],
                        'social_network_id' => ['type' => 'integer'],
                        'limit' => ['type' => 'integer'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'create_category',
                'description' => 'Create category for project and social network.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['project_id', 'social_network_id', 'name'],
                    'properties' => [
                        'project_id' => ['type' => 'integer'],
                        'social_network_id' => ['type' => 'integer'],
                        'name' => ['type' => 'string'],
                        'color' => ['type' => 'string'],
                        'description' => ['type' => 'string'],
                        'client_type' => ['type' => 'string'],
                        'avatar_name' => ['type' => 'string'],
                        'avatar_description' => ['type' => 'string'],
                        'sort_order' => ['type' => 'integer'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'update_category',
                'description' => 'Update category fields.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['category_id'],
                    'properties' => [
                        'category_id' => ['type' => 'integer'],
                        'project_id' => ['type' => 'integer'],
                        'social_network_id' => ['type' => 'integer'],
                        'name' => ['type' => 'string'],
                        'color' => ['type' => 'string'],
                        'description' => ['type' => 'string'],
                        'client_type' => ['type' => 'string'],
                        'avatar_name' => ['type' => 'string'],
                        'avatar_description' => ['type' => 'string'],
                        'sort_order' => ['type' => 'integer'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'delete_category',
                'description' => 'Delete category by ID. Optional project guard.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['category_id'],
                    'properties' => [
                        'category_id' => ['type' => 'integer'],
                        'project_id' => ['type' => 'integer'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'get_content_plan',
                'description' => 'Get posts/content plan by project and date range.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['project_id', 'date_from', 'date_to'],
                    'properties' => [
                        'project_id' => ['type' => 'integer'],
                        'date_from' => ['type' => 'string'],
                        'date_to' => ['type' => 'string'],
                        'social_network_id' => ['type' => 'integer'],
                        'limit' => ['type' => 'integer'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'add_content_plan',
                'description' => 'Add content plan item (alias for create post).',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['project_id', 'social_network_id', 'post_date'],
                    'properties' => [
                        'project_id' => ['type' => 'integer'],
                        'social_network_id' => ['type' => 'integer'],
                        'post_date' => ['type' => 'string'],
                        'category_id' => ['type' => 'integer'],
                        'text' => ['type' => 'string'],
                        'image_path' => ['type' => 'string'],
                        'image_action' => ['type' => 'string'],
                        'image_text' => ['type' => 'string'],
                        'image_prompt' => ['type' => 'string'],
                        'image_type' => ['type' => 'string'],
                        'post_type' => ['type' => 'string'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'update_content_plan',
                'description' => 'Update content plan item (alias for update post).',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['post_id'],
                    'properties' => [
                        'post_id' => ['type' => 'integer'],
                        'project_id' => ['type' => 'integer'],
                        'social_network_id' => ['type' => 'integer'],
                        'post_date' => ['type' => 'string'],
                        'category_id' => ['type' => 'integer'],
                        'text' => ['type' => 'string'],
                        'image_path' => ['type' => 'string'],
                        'image_action' => ['type' => 'string'],
                        'image_text' => ['type' => 'string'],
                        'image_prompt' => ['type' => 'string'],
                        'image_type' => ['type' => 'string'],
                        'post_type' => ['type' => 'string'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'create_post',
                'description' => 'Create post (content plan item).',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['project_id', 'social_network_id', 'post_date'],
                    'properties' => [
                        'project_id' => ['type' => 'integer'],
                        'social_network_id' => ['type' => 'integer'],
                        'post_date' => ['type' => 'string'],
                        'category_id' => ['type' => 'integer'],
                        'text' => ['type' => 'string'],
                        'image_path' => ['type' => 'string'],
                        'image_action' => ['type' => 'string'],
                        'image_text' => ['type' => 'string'],
                        'image_prompt' => ['type' => 'string'],
                        'image_type' => ['type' => 'string'],
                        'post_type' => ['type' => 'string'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'update_post',
                'description' => 'Update post fields.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['post_id'],
                    'properties' => [
                        'post_id' => ['type' => 'integer'],
                        'project_id' => ['type' => 'integer'],
                        'social_network_id' => ['type' => 'integer'],
                        'post_date' => ['type' => 'string'],
                        'category_id' => ['type' => 'integer'],
                        'text' => ['type' => 'string'],
                        'image_path' => ['type' => 'string'],
                        'image_action' => ['type' => 'string'],
                        'image_text' => ['type' => 'string'],
                        'image_prompt' => ['type' => 'string'],
                        'image_type' => ['type' => 'string'],
                        'post_type' => ['type' => 'string'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'delete_post',
                'description' => 'Delete post by ID. Optional project guard.',
                'inputSchema' => [
                    'type' => 'object',
                    'required' => ['post_id'],
                    'properties' => [
                        'post_id' => ['type' => 'integer'],
                        'project_id' => ['type' => 'integer'],
                    ],
                    'additionalProperties' => false,
                ],
            ],
            [
                'name' => 'generate_post_media',
                'description' => 'Запускає автоматичну ШІ-генерацію зображень або відео для одного або кількох постів у контент-плані.',
                'inputSchema' => [
                    'type' => 'object',
                    'properties' => [
                        'post_ids' => [
                            'type' => 'array',
                            'items' => ['type' => 'integer'],
                            'description' => 'Масив ID постів, для яких треба запустити генерацію медіа.',
                        ],
                        'project_id' => [
                            'type' => 'integer',
                            'description' => 'Опціональна перевірка, що пост належить до конкретного проєкту.',
                        ],
                    ],
                    'required' => ['post_ids'],
                    'additionalProperties' => false,
                ],
            ],
        ];
    }

    private function callTool($toolName, array $arguments)
    {
        switch ($toolName) {
            case 'list_projects':
                return $this->toolListProjects();
            case 'list_social_networks':
                return $this->toolListSocialNetworks($arguments);
            case 'create_social_network':
                return $this->toolCreateSocialNetwork($arguments);
            case 'update_social_network':
                return $this->toolUpdateSocialNetwork($arguments);
            case 'delete_social_network':
                return $this->toolDeleteSocialNetwork($arguments);
            case 'list_categories':
                return $this->toolListCategories($arguments);
            case 'create_category':
                return $this->toolCreateCategory($arguments);
            case 'update_category':
                return $this->toolUpdateCategory($arguments);
            case 'delete_category':
                return $this->toolDeleteCategory($arguments);
            case 'get_content_plan':
                return $this->toolGetContentPlan($arguments);
            case 'add_content_plan':
                return $this->toolAddContentPlan($arguments);
            case 'update_content_plan':
                return $this->toolUpdateContentPlan($arguments);
            case 'create_post':
                return $this->toolCreatePost($arguments);
            case 'update_post':
                return $this->toolUpdatePost($arguments);
            case 'delete_post':
                return $this->toolDeletePost($arguments);
            case 'generate_post_media':
                return $this->toolGeneratePostMedia($arguments);
            default:
                throw new InvalidArgumentException('Unknown tool: ' . $toolName);
        }
    }

    private function toolGeneratePostMedia(array $args)
    {
        if (!isset($args['post_ids']) || !is_array($args['post_ids'])) {
            throw new InvalidArgumentException('post_ids is required and must be array');
        }

        $projectId = null;
        if (array_key_exists('project_id', $args)) {
            $projectId = (int) $args['project_id'];
            if ($projectId <= 0) {
                throw new InvalidArgumentException('project_id must be positive integer');
            }
        }

        $started = 0;
        $failed = 0;
        $details = [];

        foreach ($args['post_ids'] as $postId) {
            $pid = (int) $postId;
            if ($pid <= 0) {
                continue;
            }

            try {
                $result = $this->generationService->startForPost($pid, $projectId, null);
                $started++;
                $details[] = [
                    'post_id' => $pid,
                    'ok' => true,
                    'status' => $result['status'] ?? 'processing',
                    'job_id' => $result['job_id'] ?? null,
                    'flow' => $result['flow'] ?? null,
                    'idempotent' => !empty($result['idempotent']),
                ];
            } catch (Throwable $e) {
                $failed++;
                $details[] = [
                    'post_id' => $pid,
                    'ok' => false,
                    'error' => $e->getMessage(),
                ];
            }
        }

        return [
            'success' => true,
            'message' => 'Запущено генерацію для ' . $started . ' постів. Процес виконується асинхронно.',
            'started' => $started,
            'failed' => $failed,
            'details' => $details,
        ];
    }

    private function toolListProjects()
    {
        $rows = $this->db->query('SELECT id, name, is_active, created_at, updated_at FROM projects ORDER BY is_active DESC, name ASC')
            ->fetchAll(PDO::FETCH_ASSOC);

        return [
            'ok' => true,
            'count' => count($rows),
            'projects' => $rows,
        ];
    }

    private function toolListSocialNetworks(array $args)
    {
        $includeDisabled = !empty($args['include_disabled']);
        if ($includeDisabled) {
            $rows = $this->db->query('SELECT id, name, prompt, is_enabled, sort_order, created_at, updated_at FROM social_networks ORDER BY sort_order ASC, id ASC')
                ->fetchAll(PDO::FETCH_ASSOC);
        } else {
            $rows = $this->db->query('SELECT id, name, prompt, is_enabled, sort_order, created_at, updated_at FROM social_networks WHERE is_enabled = 1 ORDER BY sort_order ASC, id ASC')
                ->fetchAll(PDO::FETCH_ASSOC);
        }

        return [
            'ok' => true,
            'count' => count($rows),
            'social_networks' => $rows,
        ];
    }

    private function toolCreateSocialNetwork(array $args)
    {
        $name = trim((string) ($args['name'] ?? ''));
        if ($name === '') {
            throw new InvalidArgumentException('name is required');
        }

        $prompt = trim((string) ($args['prompt'] ?? ''));
        $isEnabled = array_key_exists('is_enabled', $args) ? ((bool) $args['is_enabled'] ? 1 : 0) : 1;
        $sortOrder = array_key_exists('sort_order', $args) ? (int) $args['sort_order'] : $this->nextSortOrder('social_networks');

        $exists = $this->db->query('SELECT id FROM social_networks WHERE name = ? LIMIT 1', [$name])->fetch(PDO::FETCH_ASSOC);
        if ($exists) {
            throw new InvalidArgumentException('social network with this name already exists');
        }

        $this->db->query(
            'INSERT INTO social_networks (name, prompt, is_enabled, sort_order) VALUES (?, ?, ?, ?)',
            [$name, $prompt, $isEnabled, $sortOrder]
        );

        return [
            'ok' => true,
            'network_id' => (int) $this->db->lastInsertId(),
        ];
    }

    private function toolUpdateSocialNetwork(array $args)
    {
        $networkId = $this->requiredInt($args, 'network_id');

        $parts = [];
        $values = [];

        if (array_key_exists('name', $args)) {
            $name = trim((string) $args['name']);
            if ($name === '') {
                throw new InvalidArgumentException('name cannot be empty');
            }
            $parts[] = 'name = ?';
            $values[] = $name;
        }

        if (array_key_exists('prompt', $args)) {
            $parts[] = 'prompt = ?';
            $values[] = (string) $args['prompt'];
        }

        if (array_key_exists('is_enabled', $args)) {
            $parts[] = 'is_enabled = ?';
            $values[] = ((bool) $args['is_enabled']) ? 1 : 0;
        }

        if (array_key_exists('sort_order', $args)) {
            $parts[] = 'sort_order = ?';
            $values[] = (int) $args['sort_order'];
        }

        if (empty($parts)) {
            throw new InvalidArgumentException('no fields to update');
        }

        $values[] = $networkId;
        $this->db->query('UPDATE social_networks SET ' . implode(', ', $parts) . ' WHERE id = ?', $values);

        return [
            'ok' => true,
            'network_id' => $networkId,
        ];
    }

    private function toolDeleteSocialNetwork(array $args)
    {
        $networkId = $this->requiredInt($args, 'network_id');

        $this->db->query('DELETE FROM social_networks WHERE id = ?', [$networkId]);

        return [
            'ok' => true,
            'network_id' => $networkId,
        ];
    }

    private function toolListCategories(array $args)
    {
        $projectId = $this->requiredInt($args, 'project_id');
        $limit = $this->normalizeLimit(isset($args['limit']) ? (int) $args['limit'] : null);

        $sql = 'SELECT c.id, c.project_id, c.social_network_id, c.name, c.color, c.description';
        if ($this->hasColumn('categories', 'client_type')) {
            $sql .= ', c.client_type';
        }
        if ($this->hasColumn('categories', 'avatar_name')) {
            $sql .= ', c.avatar_name';
        }
        if ($this->hasColumn('categories', 'avatar_description')) {
            $sql .= ', c.avatar_description';
        }
        $sql .= ', c.sort_order, c.created_at, sn.name AS social_network_name
                 FROM categories c
                 LEFT JOIN social_networks sn ON sn.id = c.social_network_id
                 WHERE c.project_id = ?';

        $params = [$projectId];
        if (!empty($args['social_network_id'])) {
            $sql .= ' AND c.social_network_id = ?';
            $params[] = (int) $args['social_network_id'];
        }

        $sql .= ' ORDER BY c.sort_order ASC, c.id ASC LIMIT ' . (int) $limit;

        $rows = $this->db->query($sql, $params)->fetchAll(PDO::FETCH_ASSOC);

        return [
            'ok' => true,
            'count' => count($rows),
            'categories' => $rows,
        ];
    }

    private function toolCreateCategory(array $args)
    {
        $projectId = $this->requiredInt($args, 'project_id');
        $socialNetworkId = $this->requiredInt($args, 'social_network_id');
        $name = trim((string) ($args['name'] ?? ''));
        if ($name === '') {
            throw new InvalidArgumentException('name is required');
        }

        $columns = ['project_id', 'social_network_id', 'name', 'color', 'description', 'sort_order'];
        $values = [
            $projectId,
            $socialNetworkId,
            $name,
            trim((string) ($args['color'] ?? '#5a6c7d')),
            $this->nullableString($args, 'description'),
            array_key_exists('sort_order', $args) ? (int) $args['sort_order'] : $this->nextSortOrder('categories', 'project_id = ? AND social_network_id = ?', [$projectId, $socialNetworkId]),
        ];

        if ($this->hasColumn('categories', 'client_type')) {
            $columns[] = 'client_type';
            $values[] = $this->nullableString($args, 'client_type');
        }
        if ($this->hasColumn('categories', 'avatar_name')) {
            $columns[] = 'avatar_name';
            $values[] = $this->nullableString($args, 'avatar_name');
        }
        if ($this->hasColumn('categories', 'avatar_description')) {
            $columns[] = 'avatar_description';
            $values[] = $this->nullableString($args, 'avatar_description');
        }

        $placeholders = implode(',', array_fill(0, count($columns), '?'));

        $this->db->query(
            'INSERT INTO categories (' . implode(',', $columns) . ') VALUES (' . $placeholders . ')',
            $values
        );

        return [
            'ok' => true,
            'category_id' => (int) $this->db->lastInsertId(),
        ];
    }

    private function toolUpdateCategory(array $args)
    {
        $categoryId = $this->requiredInt($args, 'category_id');

        $parts = [];
        $values = [];

        $simpleMap = [
            'project_id',
            'social_network_id',
            'name',
            'color',
            'description',
            'sort_order',
        ];

        foreach ($simpleMap as $field) {
            if (!array_key_exists($field, $args)) {
                continue;
            }

            if ($field === 'project_id' || $field === 'social_network_id' || $field === 'sort_order') {
                $parts[] = $field . ' = ?';
                $values[] = (int) $args[$field];
                continue;
            }

            if ($field === 'description') {
                $parts[] = $field . ' = ?';
                $values[] = $this->nullableString($args, 'description');
                continue;
            }

            $parts[] = $field . ' = ?';
            $values[] = trim((string) $args[$field]);
        }

        if ($this->hasColumn('categories', 'client_type') && array_key_exists('client_type', $args)) {
            $parts[] = 'client_type = ?';
            $values[] = $this->nullableString($args, 'client_type');
        }
        if ($this->hasColumn('categories', 'avatar_name') && array_key_exists('avatar_name', $args)) {
            $parts[] = 'avatar_name = ?';
            $values[] = $this->nullableString($args, 'avatar_name');
        }
        if ($this->hasColumn('categories', 'avatar_description') && array_key_exists('avatar_description', $args)) {
            $parts[] = 'avatar_description = ?';
            $values[] = $this->nullableString($args, 'avatar_description');
        }

        if (empty($parts)) {
            throw new InvalidArgumentException('no fields to update');
        }

        $where = 'id = ?';
        $values[] = $categoryId;

        if (array_key_exists('project_id', $args)) {
            $where .= ' AND project_id = ?';
            $values[] = (int) $args['project_id'];
        }

        $this->db->query('UPDATE categories SET ' . implode(', ', $parts) . ' WHERE ' . $where, $values);

        return [
            'ok' => true,
            'category_id' => $categoryId,
        ];
    }

    private function toolDeleteCategory(array $args)
    {
        $categoryId = $this->requiredInt($args, 'category_id');
        $params = [$categoryId];

        $sql = 'DELETE FROM categories WHERE id = ?';
        if (array_key_exists('project_id', $args)) {
            $sql .= ' AND project_id = ?';
            $params[] = (int) $args['project_id'];
        }

        $this->db->query($sql, $params);

        return [
            'ok' => true,
            'category_id' => $categoryId,
        ];
    }

    private function toolGetContentPlan(array $args)
    {
        $projectId = $this->requiredInt($args, 'project_id');
        $dateFrom = $this->requiredDate($args, 'date_from');
        $dateTo = $this->requiredDate($args, 'date_to');
        $limit = $this->normalizeLimit(isset($args['limit']) ? (int) $args['limit'] : null);

        if ($dateFrom > $dateTo) {
            throw new InvalidArgumentException('date_from cannot be greater than date_to');
        }

        $sql = 'SELECT p.id, p.project_id, p.category_id, p.post_date, p.social_network_id, p.text, p.image_path, p.image_action, p.image_text';
        if ($this->hasColumn('posts', 'image_prompt')) {
            $sql .= ', p.image_prompt';
        }
        if ($this->hasColumn('posts', 'image_type')) {
            $sql .= ', p.image_type';
        }
        if ($this->hasColumn('posts', 'post_type')) {
            $sql .= ', p.post_type';
        }
        $sql .= ', c.name AS category_name, sn.name AS social_network_name
                 FROM posts p
                 LEFT JOIN categories c ON c.id = p.category_id
                 LEFT JOIN social_networks sn ON sn.id = p.social_network_id
                 WHERE p.project_id = ? AND p.post_date BETWEEN ? AND ?';

        $params = [$projectId, $dateFrom, $dateTo];

        if (!empty($args['social_network_id'])) {
            $sql .= ' AND p.social_network_id = ?';
            $params[] = (int) $args['social_network_id'];
        }

        $sql .= ' ORDER BY p.post_date ASC, p.social_network_id ASC, p.id ASC LIMIT ' . (int) $limit;

        $rows = $this->db->query($sql, $params)->fetchAll(PDO::FETCH_ASSOC);

        return [
            'ok' => true,
            'count' => count($rows),
            'posts' => $rows,
        ];
    }

    private function toolCreatePost(array $args)
    {
        $projectId = $this->requiredInt($args, 'project_id');
        $socialNetworkId = $this->requiredInt($args, 'social_network_id');
        $postDate = $this->requiredDate($args, 'post_date');

        $columns = ['project_id', 'social_network_id', 'post_date', 'category_id', 'text', 'image_path', 'image_action', 'image_text'];
        $values = [
            $projectId,
            $socialNetworkId,
            $postDate,
            array_key_exists('category_id', $args) ? ((int) $args['category_id'] > 0 ? (int) $args['category_id'] : null) : null,
            (string) ($args['text'] ?? ''),
            $this->nullableString($args, 'image_path'),
            (string) ($args['image_action'] ?? 'nothing'),
            $this->nullableString($args, 'image_text'),
        ];

        if ($this->hasColumn('posts', 'image_prompt')) {
            $columns[] = 'image_prompt';
            $values[] = $this->nullableString($args, 'image_prompt');
        }
        if ($this->hasColumn('posts', 'image_type')) {
            $columns[] = 'image_type';
            $values[] = $this->nullableString($args, 'image_type');
        }
        if ($this->hasColumn('posts', 'post_type')) {
            $columns[] = 'post_type';
            $values[] = $this->nullableString($args, 'post_type');
        }

        $placeholders = implode(',', array_fill(0, count($columns), '?'));
        $this->db->query('INSERT INTO posts (' . implode(',', $columns) . ') VALUES (' . $placeholders . ')', $values);

        return [
            'ok' => true,
            'post_id' => (int) $this->db->lastInsertId(),
        ];
    }

    private function toolAddContentPlan(array $args)
    {
        return $this->toolCreatePost($args);
    }

    private function toolUpdatePost(array $args)
    {
        $postId = $this->requiredInt($args, 'post_id');

        $parts = [];
        $values = [];

        $intFields = ['project_id', 'social_network_id', 'category_id'];
        $stringFields = ['text', 'image_path', 'image_action', 'image_text'];

        foreach ($intFields as $field) {
            if (!array_key_exists($field, $args)) {
                continue;
            }

            if ($field === 'category_id') {
                $parts[] = 'category_id = ?';
                $value = (int) $args['category_id'];
                $values[] = $value > 0 ? $value : null;
                continue;
            }

            $parts[] = $field . ' = ?';
            $values[] = (int) $args[$field];
        }

        foreach ($stringFields as $field) {
            if (!array_key_exists($field, $args)) {
                continue;
            }

            if ($field === 'text' || $field === 'image_action') {
                $parts[] = $field . ' = ?';
                $values[] = (string) $args[$field];
                continue;
            }

            $parts[] = $field . ' = ?';
            $values[] = $this->nullableString($args, $field);
        }

        if (array_key_exists('post_date', $args)) {
            $parts[] = 'post_date = ?';
            $values[] = $this->requiredDate($args, 'post_date');
        }

        if ($this->hasColumn('posts', 'image_prompt') && array_key_exists('image_prompt', $args)) {
            $parts[] = 'image_prompt = ?';
            $values[] = $this->nullableString($args, 'image_prompt');
        }
        if ($this->hasColumn('posts', 'image_type') && array_key_exists('image_type', $args)) {
            $parts[] = 'image_type = ?';
            $values[] = $this->nullableString($args, 'image_type');
        }
        if ($this->hasColumn('posts', 'post_type') && array_key_exists('post_type', $args)) {
            $parts[] = 'post_type = ?';
            $values[] = $this->nullableString($args, 'post_type');
        }

        if (empty($parts)) {
            throw new InvalidArgumentException('no fields to update');
        }

        $where = 'id = ?';
        $values[] = $postId;

        if (array_key_exists('project_id', $args)) {
            $where .= ' AND project_id = ?';
            $values[] = (int) $args['project_id'];
        }

        $this->db->query('UPDATE posts SET ' . implode(', ', $parts) . ' WHERE ' . $where, $values);

        return [
            'ok' => true,
            'post_id' => $postId,
        ];
    }

    private function toolUpdateContentPlan(array $args)
    {
        return $this->toolUpdatePost($args);
    }

    private function toolDeletePost(array $args)
    {
        $postId = $this->requiredInt($args, 'post_id');
        $params = [$postId];

        $sql = 'DELETE FROM posts WHERE id = ?';
        if (array_key_exists('project_id', $args)) {
            $sql .= ' AND project_id = ?';
            $params[] = (int) $args['project_id'];
        }

        $this->db->query($sql, $params);

        return [
            'ok' => true,
            'post_id' => $postId,
        ];
    }

    private function requiredInt(array $args, $key)
    {
        if (!array_key_exists($key, $args)) {
            throw new InvalidArgumentException($key . ' is required');
        }

        $value = (int) $args[$key];
        if ($value <= 0) {
            throw new InvalidArgumentException($key . ' must be positive integer');
        }

        return $value;
    }

    private function requiredDate(array $args, $key)
    {
        $value = trim((string) ($args[$key] ?? ''));
        if ($value === '') {
            throw new InvalidArgumentException($key . ' is required');
        }

        $dt = DateTime::createFromFormat('Y-m-d', $value);
        if (!$dt || $dt->format('Y-m-d') !== $value) {
            throw new InvalidArgumentException($key . ' must be in format Y-m-d');
        }

        return $value;
    }

    private function nullableString(array $args, $key)
    {
        if (!array_key_exists($key, $args)) {
            return null;
        }

        $value = trim((string) $args[$key]);
        return $value === '' ? null : $value;
    }

    private function normalizeLimit($value)
    {
        $default = isset($this->config['default_limit']) ? (int) $this->config['default_limit'] : 200;
        if ($default <= 0) {
            $default = 200;
        }

        if ($value === null || $value <= 0) {
            return $default;
        }

        return min($value, 1000);
    }

    private function nextSortOrder($tableName, $whereSql = '', array $params = [])
    {
        $sql = 'SELECT COALESCE(MAX(sort_order), 0) AS max_sort FROM ' . $tableName;
        if ($whereSql !== '') {
            $sql .= ' WHERE ' . $whereSql;
        }

        $row = $this->db->query($sql, $params)->fetch(PDO::FETCH_ASSOC);
        return (int) ($row['max_sort'] ?? 0) + 1;
    }

    private function hasColumn($tableName, $columnName)
    {
        $cacheKey = $tableName . ':' . $columnName;
        if (array_key_exists($cacheKey, $this->columnsCache)) {
            return $this->columnsCache[$cacheKey];
        }

        $row = $this->db->query('SHOW COLUMNS FROM ' . $tableName . ' LIKE ?', [$columnName])->fetch(PDO::FETCH_ASSOC);
        $this->columnsCache[$cacheKey] = (bool) $row;

        return $this->columnsCache[$cacheKey];
    }

    private function authorize()
    {
        $token = (string) ($this->config['token'] ?? getenv('MCP_TOKEN') ?: '');
        if ($token === '') {
            return true;
        }

        $incoming = $this->extractIncomingToken();
        return is_string($incoming) && hash_equals($token, $incoming);
    }

    private function extractIncomingToken()
    {
        $headerToken = $this->extractTokenFromHeaders();
        if (is_string($headerToken) && $headerToken !== '') {
            return $headerToken;
        }

        return $this->extractTokenFromQuery();
    }

    private function extractTokenFromHeaders()
    {
        $authHeader = $this->readHeader('Authorization');
        if (is_string($authHeader) && preg_match('/^Bearer\s+(.+)$/i', trim($authHeader), $matches)) {
            return trim($matches[1]);
        }

        $xToken = $this->readHeader('X-MCP-Token');
        if (is_string($xToken) && trim($xToken) !== '') {
            return trim($xToken);
        }

        return null;
    }

    private function extractTokenFromQuery()
    {
        $candidates = ['token', 'mcp_token', 'access_token'];
        foreach ($candidates as $key) {
            if (!isset($_GET[$key])) {
                continue;
            }

            $value = trim((string) $_GET[$key]);
            if ($value !== '') {
                return $value;
            }
        }

        return null;
    }

    private function readHeader($name)
    {
        $normalized = strtoupper(str_replace('-', '_', $name));
        $serverKey = 'HTTP_' . $normalized;

        if (isset($_SERVER[$serverKey])) {
            return (string) $_SERVER[$serverKey];
        }

        if ($normalized === 'AUTHORIZATION' && isset($_SERVER['REDIRECT_HTTP_AUTHORIZATION'])) {
            return (string) $_SERVER['REDIRECT_HTTP_AUTHORIZATION'];
        }

        return null;
    }

    private function applyCors()
    {
        header('Content-Type: application/json; charset=utf-8');

        $allowedOrigins = isset($this->config['allowed_origins']) && is_array($this->config['allowed_origins'])
            ? $this->config['allowed_origins']
            : [];

        if (empty($allowedOrigins)) {
            return;
        }

        $requestOrigin = isset($_SERVER['HTTP_ORIGIN']) ? trim((string) $_SERVER['HTTP_ORIGIN']) : '';
        if ($requestOrigin !== '' && in_array($requestOrigin, $allowedOrigins, true)) {
            header('Access-Control-Allow-Origin: ' . $requestOrigin);
            header('Vary: Origin');
            header('Access-Control-Allow-Headers: Content-Type, Authorization, X-MCP-Token');
            header('Access-Control-Allow-Methods: POST, OPTIONS');
        }
    }

    private function jsonResponse(array $payload)
    {
        echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT);
    }

    private function jsonRpcResult($id, array $result)
    {
        echo json_encode([
            'jsonrpc' => '2.0',
            'id' => $id,
            'result' => $result,
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private function jsonRpcError($id, $code, $message)
    {
        echo json_encode([
            'jsonrpc' => '2.0',
            'id' => $id,
            'error' => [
                'code' => (int) $code,
                'message' => (string) $message,
            ],
        ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }
}
