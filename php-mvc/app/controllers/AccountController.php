<?php
// app/controllers/AccountController.php
require_once __DIR__ . '/../core/BaseController.php';

class AccountController extends BaseController
{
    public function __construct($db)
    {
        parent::__construct($db);
    }
    
    public function index()
    {
        $projectData = $this->ensureProjectSelected();
        $projects = $projectData['projects'];
        $active_project_id = $projectData['active_project_id'];
        
        $stmt = $this->db->query('SELECT * FROM accounts');
        $accounts = $stmt->fetchAll();
        require __DIR__ . '/../views/accounts.php';
    }
    
    public function addForm()
    {
        $projectData = $this->ensureProjectSelected();
        $projects = $projectData['projects'];
        $active_project_id = $projectData['active_project_id'];
        
        require __DIR__ . '/../views/account_form.php';
    }
    public function add()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];
        
        $fields = [
            'name' => $_POST['name'] ?? '',
            'platform' => $_POST['platform'] ?? '',
            'bot_token' => $_POST['bot_token'] ?? '',
            'chat_id' => $_POST['chat_id'] ?? '',
            'status' => !empty($_POST['status']) ? 1 : 0
        ];
        $sql = "INSERT INTO accounts (name, platform, bot_token, chat_id, status) VALUES (?, ?, ?, ?, ?)";
        $this->db->query($sql, array_values($fields));
        header('Location: /accounts?project_id=' . $active_project_id);
        exit;
    }
    public function editForm()
    {
        $projectData = $this->ensureProjectSelected();
        $projects = $projectData['projects'];
        $active_project_id = $projectData['active_project_id'];
        
        $id = $_GET['id'] ?? null;
        if (!$id) {
            header('Location: /accounts?project_id=' . $active_project_id);
            exit;
        }
        $stmt = $this->db->query('SELECT * FROM accounts WHERE id = ?', [$id]);
        $account = $stmt->fetch();
        require __DIR__ . '/../views/account_form.php';
    }
    public function update()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];
        
        $id = $_POST['id'] ?? null;
        if (!$id) {
            header('Location: /accounts?project_id=' . $active_project_id);
            exit;
        }
        $fields = [
            $_POST['name'] ?? '',
            $_POST['platform'] ?? '',
            $_POST['bot_token'] ?? '',
            $_POST['chat_id'] ?? '',
            !empty($_POST['status']) ? 1 : 0,
            $id
        ];
        $sql = "UPDATE accounts SET name=?, platform=?, bot_token=?, chat_id=?, status=? WHERE id=?";
        $this->db->query($sql, $fields);
        header('Location: /accounts?project_id=' . $active_project_id);
        exit;
    }
    public function delete()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];
        
        $id = $_GET['id'] ?? null;
        if ($id) {
            $this->db->query('DELETE FROM accounts WHERE id=?', [$id]);
        }
        header('Location: /accounts?project_id=' . $active_project_id);
        exit;
    }
    public function toggle()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];
        
        $id = $_GET['id'] ?? null;
        if ($id) {
            $stmt = $this->db->query('SELECT status FROM accounts WHERE id=?', [$id]);
            $acc = $stmt->fetch();
            $newStatus = $acc['status'] ? 0 : 1;
            $this->db->query('UPDATE accounts SET status=? WHERE id=?', [$newStatus, $id]);
        }
        header('Location: /accounts?project_id=' . $active_project_id);
        exit;
    }
    public function test()
    {
        $projectData = $this->ensureProjectSelected();
        $active_project_id = $projectData['active_project_id'];
        
        // Тут буде логіка тестового повідомлення в Telegram
        header('Location: /accounts?project_id=' . $active_project_id);
        exit;
    }
}
