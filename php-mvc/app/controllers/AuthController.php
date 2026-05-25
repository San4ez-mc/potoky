<?php
// app/controllers/AuthController.php
class AuthController
{
    private $db;
    public function __construct($db)
    {
        $this->db = $db;
        if (session_status() === PHP_SESSION_NONE) session_start();
    }
    public function loginForm()
    {
        require __DIR__ . '/../views/login.php';
    }
    public function login()
    {
        $username = $_POST['username'] ?? '';
        $password = $_POST['password'] ?? '';
        $stmt = $this->db->query('SELECT * FROM admin WHERE username = ?', [$username]);
        $admin = $stmt->fetch();
        if ($admin && password_verify($password, $admin['password_hash'])) {
            $_SESSION['admin_id'] = $admin['id'];
            header('Location: /');
            exit;
        } else {
            $error = 'Невірний логін або пароль';
            require __DIR__ . '/../views/login.php';
        }
    }
    public function logout()
    {
        session_destroy();
        header('Location: /login');
        exit;
    }
    public static function check()
    {
        if (session_status() === PHP_SESSION_NONE) session_start();
        if (empty($_SESSION['admin_id'])) {
            header('Location: /login');
            exit;
        }
    }
}
