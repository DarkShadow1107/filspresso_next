CREATE DATABASE IF NOT EXISTS kafelot_iot DEFAULT CHARACTER SET = 'utf8mb4' DEFAULT COLLATE = 'utf8mb4_general_ci';
USE kafelot_iot;

CREATE TABLE IF NOT EXISTS commands (
  command_id BIGINT PRIMARY KEY AUTO_INCREMENT,
  machine_id VARCHAR(255) NOT NULL,
  recipe_json JSON NOT NULL,
  execute_allowed TINYINT NOT NULL DEFAULT 1,
  status VARCHAR(32) NOT NULL DEFAULT 'pending',
  meta_json JSON,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_machine_status_created (machine_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
