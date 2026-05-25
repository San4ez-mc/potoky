-- MySQL schema for Content Planner Bot
-- Доменні сутності: categories + posts

CREATE TABLE admin (
    id INT AUTO_INCREMENT PRIMARY KEY,
    username VARCHAR(50) NOT NULL UNIQUE,
    password_hash VARCHAR(100) NOT NULL
);

CREATE TABLE projects (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(120) NOT NULL,
    is_active TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE admin_projects (
    admin_id INT NOT NULL,
    project_id INT NOT NULL,
    can_manage_settings TINYINT(1) NOT NULL DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (admin_id, project_id),
    FOREIGN KEY (admin_id) REFERENCES admin(id) ON DELETE CASCADE,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE social_networks (
    id INT AUTO_INCREMENT PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    prompt TEXT NOT NULL,
    is_enabled TINYINT(1) NOT NULL DEFAULT 1,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE categories (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    social_network_id INT NOT NULL,
    name VARCHAR(80) NOT NULL,
    color VARCHAR(10) NOT NULL DEFAULT '#5a6c7d',
    description VARCHAR(255),
    client_type VARCHAR(20) NULL,
    avatar_name VARCHAR(120) NULL,
    avatar_description VARCHAR(255) NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (social_network_id) REFERENCES social_networks(id) ON DELETE CASCADE
);

CREATE TABLE posts (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    category_id INT,
    post_date DATE NOT NULL,
    social_network_id INT NOT NULL,
    text TEXT NOT NULL,
    image_path VARCHAR(255) NULL,
    image_action VARCHAR(20) NOT NULL DEFAULT 'nothing',
    image_text VARCHAR(255) NULL,
    image_prompt TEXT NULL,
    image_type VARCHAR(50) NULL,
    post_type VARCHAR(50) NULL,
    avatar_engine VARCHAR(40) NULL,
    generation_status VARCHAR(20) NOT NULL DEFAULT 'not_generated',
    generation_job_id VARCHAR(120) NULL,
    generation_flow_key VARCHAR(50) NULL,
    generation_output_url TEXT NULL,
    generation_error TEXT NULL,
    generation_requested_at DATETIME NULL,
    generation_finished_at DATETIME NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE SET NULL,
    FOREIGN KEY (social_network_id) REFERENCES social_networks(id) ON DELETE CASCADE
);

CREATE TABLE settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    project_id INT NOT NULL,
    setting_key VARCHAR(100) NOT NULL,
    setting_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uniq_project_setting (project_id, setting_key),
    FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);