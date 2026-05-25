<!-- Project Dropdown Topbar Component -->
<div class="topbar">
    <div class="logo">📋 Content Planner Bot</div>
    <div class="menu">
        <a href="/?project_id=<?php echo $active_project_id; ?>">Контент план</a>
        <a href="/social-networks?project_id=<?php echo $active_project_id; ?>">Соц.мережі</a>
        <a href="/images?project_id=<?php echo $active_project_id; ?>">Зображення</a>
        <a href="/content?project_id=<?php echo $active_project_id; ?>">🎬 Відео</a>
        <a href="/settings?project_id=<?php echo $active_project_id; ?>">Налаштування</a>
    </div>
    <div class="project-dropdown">
        <button class="project-dropdown-btn" onclick="toggleProjectDropdown(event)">
            <span class="project-name">
                <?php
                foreach ($projects as $p) {
                    if ((int) $p['id'] === (int) $active_project_id) {
                        echo htmlspecialchars($p['name'], ENT_QUOTES, 'UTF-8');
                        break;
                    }
                }
                ?>
            </span>
            <span class="dropdown-arrow">▼</span>
        </button>
        <div class="project-dropdown-menu" id="projectDropdownMenu">
            <div class="dropdown-section">
                <div class="dropdown-label">Проекти:</div>
                <?php foreach ($projects as $project): ?>
                    <a href="?project_id=<?php echo (int) $project['id']; ?>"
                        class="dropdown-item <?php echo ((int) $project['id'] === (int) $active_project_id) ? 'active' : ''; ?>">
                        <?php echo htmlspecialchars($project['name'], ENT_QUOTES, 'UTF-8'); ?>
                    </a>
                <?php endforeach; ?>
            </div>
            <div class="dropdown-divider"></div>
            <div class="dropdown-section add-project-section">
                <div class="dropdown-label">Додати проєкт:</div>
                <form method="POST" action="/projects/create" class="add-project-form">
                    <input type="text" name="project_name" class="add-project-input" placeholder="Назва нового проєкту"
                        maxlength="120" required>
                    <input type="hidden" name="return_to"
                        value="<?php echo htmlspecialchars($_SERVER['REQUEST_URI'] ?? '/', ENT_QUOTES, 'UTF-8'); ?>">
                    <button type="submit" class="add-project-btn">+ Додати</button>
                </form>
            </div>
            <div class="dropdown-divider"></div>
            <a href="/logout" class="dropdown-item logout-item">🚪 Вийти</a>
        </div>
    </div>
</div>

<?php if (!empty($_GET['project_created'])): ?>
    <div class="topbar-flash success">Проєкт успішно створено ✅</div>
<?php elseif (!empty($_GET['project_create_error'])): ?>
    <div class="topbar-flash error">Не вдалося створити проєкт. Спробуйте ще раз.</div>
<?php endif; ?>

<script>
    function toggleProjectDropdown(event) {
        event.stopPropagation();
        const menu = document.getElementById('projectDropdownMenu');
        menu.classList.toggle('show');
    }

    // Закрити меню при кліку поза ним
    document.addEventListener('click', function (event) {
        const menu = document.getElementById('projectDropdownMenu');
        const btn = document.querySelector('.project-dropdown-btn');
        if (menu && !menu.contains(event.target) && !btn.contains(event.target)) {
            menu.classList.remove('show');
        }
    });
</script>

<style>
    .project-dropdown {
        position: relative;
        display: inline-block;
    }

    .project-dropdown-btn {
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        padding: 8px 16px;
        font-size: 14px;
        cursor: pointer;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.2s;
    }

    .project-dropdown-btn:hover {
        background: #f9fafb;
        border-color: #5a6c7d;
    }

    .project-name {
        font-weight: 500;
        color: #2c3e50;
        max-width: 150px;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .dropdown-arrow {
        color: #7f8c8d;
        font-size: 10px;
        transition: transform 0.2s;
    }

    .project-dropdown-btn:hover .dropdown-arrow {
        color: #5a6c7d;
    }

    .project-dropdown-menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        background: white;
        border: 1px solid #ddd;
        border-radius: 8px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
        min-width: 220px;
        z-index: 1000;
        opacity: 0;
        visibility: hidden;
        transform: translateY(-10px);
        transition: all 0.2s;
    }

    .project-dropdown-menu.show {
        opacity: 1;
        visibility: visible;
        transform: translateY(0);
    }

    .dropdown-section {
        padding: 8px 0;
    }

    .dropdown-label {
        padding: 8px 16px;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        color: #7f8c8d;
        letter-spacing: 0.5px;
    }

    .topbar .project-dropdown-menu .dropdown-item {
        display: block;
        padding: 10px 16px;
        color: #2c3e50;
        text-decoration: none;
        font-size: 14px;
        transition: background 0.2s;
    }

    .topbar .project-dropdown-menu .dropdown-item:hover {
        background: #f9fafb;
        color: #1f2937;
    }

    .topbar .project-dropdown-menu .dropdown-item.active {
        background: #e8f4f8;
        color: #27485f;
        font-weight: 500;
        position: relative;
    }

    .topbar .project-dropdown-menu .dropdown-item.active::before {
        content: '✓';
        position: absolute;
        left: 16px;
        font-weight: bold;
        color: #27485f;
    }

    .topbar .project-dropdown-menu .dropdown-item.active {
        padding-left: 36px;
    }

    .dropdown-divider {
        height: 1px;
        background: #e5e5e5;
        margin: 4px 0;
    }

    .add-project-section {
        padding: 10px 12px 12px;
    }

    .add-project-form {
        display: flex;
        flex-direction: column;
        gap: 8px;
    }

    .add-project-input {
        width: 100%;
        border: 1px solid #d1d5db;
        border-radius: 6px;
        padding: 8px 10px;
        font-size: 13px;
        color: #2c3e50;
        box-sizing: border-box;
    }

    .add-project-input:focus {
        outline: none;
        border-color: #5a6c7d;
    }

    .add-project-btn {
        border: 0;
        border-radius: 6px;
        padding: 8px 10px;
        background: #5a6c7d;
        color: #fff;
        font-size: 13px;
        cursor: pointer;
        transition: background 0.2s;
    }

    .add-project-btn:hover {
        background: #4a5c6d;
    }

    .topbar .project-dropdown-menu .logout-item {
        color: #e74c3c;
    }

    .topbar .project-dropdown-menu .logout-item:hover {
        background: #fee;
        color: #c0392b;
    }

    .topbar-flash {
        margin: 10px 24px 0;
        padding: 10px 12px;
        border-radius: 8px;
        font-size: 14px;
        border: 1px solid transparent;
    }

    .topbar-flash.success {
        background: #ecfdf5;
        border-color: #86efac;
        color: #166534;
    }

    .topbar-flash.error {
        background: #fef2f2;
        border-color: #fca5a5;
        color: #991b1b;
    }
</style>