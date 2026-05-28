-- Michael Bot: повна схема БД
-- MySQL 8.0+ / MariaDB 10.5+
-- Кодування: utf8mb4_unicode_ci

CREATE TABLE IF NOT EXISTS `leads` (
  `id`               INT PRIMARY KEY AUTO_INCREMENT,
  `telegram_id`      BIGINT UNIQUE NOT NULL,
  `username`         VARCHAR(100)  NULL,
  `first_name`       VARCHAR(100)  NULL,
  `phone`            VARCHAR(20)   NULL,
  `business_type`    VARCHAR(100)  NULL,
  `pain_summary`     TEXT          NULL,
  `hours_lost`       DECIMAL(5,1)  NULL,
  `money_lost`       DECIMAL(10,2) NULL,
  `matched_case_id`  INT           NULL,
  `stage`            ENUM('new','qualified','cta_sent','booked','rejected','archived') DEFAULT 'new',
  `followup_count`   TINYINT       DEFAULT 0,
  `last_message_at`  DATETIME      NULL,
  `meeting_at`       DATETIME      NULL,
  `fineko_task_id`   VARCHAR(100)  NULL,
  `created_at`       DATETIME      DEFAULT NOW(),
  INDEX `idx_stage` (`stage`),
  INDEX `idx_last_message` (`last_message_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `messages` (
  `id`           INT PRIMARY KEY AUTO_INCREMENT,
  `lead_id`      INT NOT NULL,
  `role`         ENUM('user','assistant') NOT NULL,
  `content`      TEXT NOT NULL,
  `stage_at_send` VARCHAR(50) NULL,
  `api_call_id`  VARCHAR(100) NULL,
  `created_at`   DATETIME DEFAULT NOW(),
  INDEX `idx_lead_id` (`lead_id`),
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `cases` (
  `id`            INT PRIMARY KEY AUTO_INCREMENT,
  `category`      ENUM('automation','consulting') NOT NULL,
  `title`         VARCHAR(255) NOT NULL,
  `business_type` VARCHAR(100) NULL,
  `keywords`      TEXT         NULL,
  `problem`       TEXT         NULL,
  `solution`      TEXT         NULL,
  `result`        TEXT         NULL,
  `hours_saved`   DECIMAL(5,1) NULL,
  `money_saved`   DECIMAL(10,2) NULL,
  `is_active`     TINYINT(1)   DEFAULT 1
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `process_log` (
  `id`          INT PRIMARY KEY AUTO_INCREMENT,
  `lead_id`     INT NOT NULL,
  `event_type`  ENUM(
    'msg_received','claude_called','case_matched','slots_shown',
    'fineko_created','notification_sent','followup_sent','stage_changed','error'
  ) NOT NULL,
  `event_data`  JSON NULL,
  `duration_ms` INT  NULL,
  `created_at`  DATETIME DEFAULT NOW(),
  INDEX `idx_lead_id` (`lead_id`),
  FOREIGN KEY (`lead_id`) REFERENCES `leads`(`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS `settings` (
  `key`   VARCHAR(100) PRIMARY KEY,
  `value` TEXT NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Стартові налаштування
INSERT IGNORE INTO `settings` VALUES
('followup_delay_1',       '30'),
('followup_delay_2',       '1440'),
('followup_delay_3',       '4320'),
('followup_delay_archive', '10080'),
('slot_duration_min',      '60'),
('slots_to_show',          '3'),
('working_hours_start',    '9'),
('working_hours_end',      '18'),
('test_mode',              '0');

-- Стартові кейси (автоматизація)
INSERT IGNORE INTO `cases` (category, title, business_type, keywords, problem, solution, result) VALUES
('automation', 'Автоакти і рахунки (Google Apps Script)', 'Послуги, B2B',
 'документи, акти, рахунки, шаблони',
 'Щоразу вручну заповнювати акти і рахунки — 15-20 хвилин на документ.',
 'Google Apps Script, що автоматично заповнює шаблони з CRM і надсилає клієнту.',
 '30 секунд замість 15-20 хвилин на документ'),

('automation', 'Платформа заявок для паливної компанії', 'Логістика, склад',
 'заявки, водії, логістика, звіти',
 'Заявки від водіїв приходили в хаотичному порядку, постійні помилки.',
 'Веб-платформа з мобільним інтерфейсом для водіїв і дашбордом для менеджерів.',
 '100-200 заявок/день без хаосу'),

('automation', 'ERP для компанії теплогідроізоляції', 'Виробництво, будівництво',
 'фінанси, проекти, склад, ERP',
 'Фінанси, склад і проекти в різних таблицях і без єдиної картини.',
 'Власна ERP-система на Google Sheets + Apps Script з модулями.',
 'Вся компанія в одній платформі'),

('consulting', 'Хаос у витратах — фінансова дисципліна', 'Виробництво, будівництво',
 'витрати, фінанси, бюджет, хаос',
 'Гроші "зникали" — ніхто не знав куди йдуть витрати.',
 'Система категорій витрат, бюджети, щотижневий звіт для власника.',
 'Нецільові витрати -80%'),

('consulting', 'Збиткові проекти — план-факт', 'Виробництво, будівництво',
 'проекти, збитки, маржа, собівартість',
 'Проекти закривались в мінус, причини незрозумілі.',
 'Система план-факт по кожному проекту, облік прямих і непрямих витрат.',
 'Витрати -30%, маржа +11%, +110 000 $/рік');
