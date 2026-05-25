<?php
// public/index.php
session_start();
$config = require __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../app/core/Database.php';

$db = new Database($config);

// Simple router
$uri = trim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
if ($uri === '' || $uri === 'home') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->index();
} elseif ($uri === 'mcp') {
    require __DIR__ . '/mcp.php';
    exit;
} elseif ($uri === 'api/generation/webhook' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/GenerationController.php';
    $controller = new GenerationController($db);
    $controller->webhook();
} elseif ($uri === 'generation/run' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/GenerationController.php';
    $controller = new GenerationController($db);
    $controller->run();
} elseif ($uri === 'generation/run-bulk' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/GenerationController.php';
    $controller = new GenerationController($db);
    $controller->runBulk();
} elseif ($uri === 'generation/run-day' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/GenerationController.php';
    $controller = new GenerationController($db);
    $controller->runDay();
} elseif ($uri === 'generation/status' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/GenerationController.php';
    $controller = new GenerationController($db);
    $controller->status();
} elseif ($uri === 'generation/update-avatar-engine' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/GenerationController.php';
    $controller = new GenerationController($db);
    $controller->updateAvatarEngine();
} elseif ($uri === 'content-plan/add-category' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->addCategoryToDate();
} elseif ($uri === 'content-plan/create-post' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->createPost();
} elseif ($uri === 'content-plan/delete-post' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->deletePost();
} elseif ($uri === 'content-plan/save-post' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->savePost();
} elseif ($uri === 'content-plan/update-post-category' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->updatePostCategory();
} elseif ($uri === 'content-plan/update-category-meta' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->updateCategoryMeta();
} elseif ($uri === 'content-plan/update-post-image' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->updatePostImage();
} elseif ($uri === 'content-plan/update-image-action' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->updateImageAction();
} elseif ($uri === 'content-plan/run-image-action' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->runImageAction();
} elseif ($uri === 'content-plan/delete-post-image' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->deletePostImage();
} elseif ($uri === 'content-plan/update-image-text' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->updateImageText();
} elseif ($uri === 'content-plan/update-image-prompt' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->updateImagePrompt();
} elseif ($uri === 'content-plan/update-image-type' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->updateImageType();
} elseif ($uri === 'content-plan/update-post-type' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/HomeController.php';
    $controller = new HomeController($db);
    $controller->updatePostType();
} elseif ($uri === 'login' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/AuthController.php';
    $controller = new AuthController($db);
    $controller->loginForm();
} elseif ($uri === 'login' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/AuthController.php';
    $controller = new AuthController($db);
    $controller->login();
} elseif ($uri === 'logout') {
    require_once __DIR__ . '/../app/controllers/AuthController.php';
    $controller = new AuthController($db);
    $controller->logout();
} elseif ($uri === 'accounts') {
    require_once __DIR__ . '/../app/controllers/AccountController.php';
    $controller = new AccountController($db);
    $controller->index();
} elseif ($uri === 'accounts/add' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/AccountController.php';
    $controller = new AccountController($db);
    $controller->addForm();
} elseif ($uri === 'accounts/add' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/AccountController.php';
    $controller = new AccountController($db);
    $controller->add();
} elseif ($uri === 'accounts/edit' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/AccountController.php';
    $controller = new AccountController($db);
    $controller->editForm();
} elseif ($uri === 'accounts/edit' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/AccountController.php';
    $controller = new AccountController($db);
    $controller->update();
} elseif ($uri === 'accounts/delete' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/AccountController.php';
    $controller = new AccountController($db);
    $controller->delete();
} elseif ($uri === 'accounts/toggle' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/AccountController.php';
    $controller = new AccountController($db);
    $controller->toggle();
} elseif ($uri === 'accounts/test' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/AccountController.php';
    $controller = new AccountController($db);
    $controller->test();
} elseif ($uri === 'social-networks' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/SocialNetworkController.php';
    $controller = new SocialNetworkController($db);
    $controller->index();
} elseif ($uri === 'social-networks/edit' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/SocialNetworkController.php';
    $controller = new SocialNetworkController($db);
    $controller->editForm();
} elseif ($uri === 'social-networks/edit' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/SocialNetworkController.php';
    $controller = new SocialNetworkController($db);
    $controller->save();
} elseif ($uri === 'social-networks/status' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/SocialNetworkController.php';
    $controller = new SocialNetworkController($db);
    $controller->updateStatus();
} elseif ($uri === 'social-networks/import-content' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/SocialNetworkController.php';
    $controller = new SocialNetworkController($db);
    $controller->importContent();
} elseif ($uri === 'social-networks/export-content' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/SocialNetworkController.php';
    $controller = new SocialNetworkController($db);
    $controller->exportContent();
} elseif ($uri === 'social-networks/create' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/SocialNetworkController.php';
    $controller = new SocialNetworkController($db);
    $controller->create();
} elseif ($uri === 'social-networks/delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/SocialNetworkController.php';
    $controller = new SocialNetworkController($db);
    $controller->deleteNetwork();
} elseif ($uri === 'settings' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/SettingsController.php';
    $controller = new SettingsController($db);
    $controller->index();
} elseif ($uri === 'settings/save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/SettingsController.php';
    $controller = new SettingsController($db);
    $controller->save();
} elseif ($uri === 'content' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/ContentController.php';
    $controller = new ContentController($db);
    $controller->index();
} elseif ($uri === 'api/content-generate' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ContentApiController.php';
    $controller = new ContentApiController($db);
    $controller->generate();
} elseif ($uri === 'api/content-callback' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ContentApiController.php';
    $controller = new ContentApiController($db);
    $controller->callback();
} elseif ($uri === 'api/content-status' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/ContentApiController.php';
    $controller = new ContentApiController($db);
    $controller->status();
} elseif ($uri === 'api/source-images' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/ImagesController.php';
    $controller = new ImagesController($db);
    $controller->listSourceImages();
} elseif ($uri === 'images' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/ImagesController.php';
    $controller = new ImagesController($db);
    $controller->index();
} elseif ($uri === 'images/upload-ajax' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ImagesController.php';
    $controller = new ImagesController($db);
    $controller->uploadSourceImageAjax();
} elseif ($uri === 'images/upload' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ImagesController.php';
    $controller = new ImagesController($db);
    $controller->uploadSourceImage();
} elseif ($uri === 'images/generate-variations' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ImagesController.php';
    $controller = new ImagesController($db);
    $controller->generateVariations();
} elseif ($uri === 'images/delete' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ImagesController.php';
    $controller = new ImagesController($db);
    $controller->deleteSourceImage();
} elseif ($uri === 'images/add-prompt' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ImagesController.php';
    $controller = new ImagesController($db);
    $controller->addPrompt();
} elseif ($uri === 'images/delete-prompt' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ImagesController.php';
    $controller = new ImagesController($db);
    $controller->deletePrompt();
} elseif ($uri === 'project-access' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/ProjectAccessController.php';
    $controller = new ProjectAccessController($db);
    $controller->index();
} elseif ($uri === 'project-access/save' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ProjectAccessController.php';
    $controller = new ProjectAccessController($db);
    $controller->save();
} elseif ($uri === 'projects/create' && $_SERVER['REQUEST_METHOD'] === 'POST') {
    require_once __DIR__ . '/../app/controllers/ProjectAccessController.php';
    $controller = new ProjectAccessController($db);
    $controller->create();
} elseif ($uri === 'cron/daily-posts' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/CronController.php';
    $controller = new CronController($db);
    $controller->sendDailyPosts();
} elseif ($uri === 'cron/test' && $_SERVER['REQUEST_METHOD'] === 'GET') {
    require_once __DIR__ . '/../app/controllers/CronController.php';
    $controller = new CronController($db);
    $controller->test();
} else {
    http_response_code(404);
    echo '404 Not Found';
}
