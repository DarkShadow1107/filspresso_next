-- =============================================================================
-- MEMBER STATUS TABLE (tracks coffee ordering status and tier)
-- =============================================================================
-- Stores user's coffee ordering statistics for member tier calculation
-- Sleeves are counted, each sleeve = 10 capsules
-- Tiers: Connoisseur (1+), Expert (750+), Master (2000+), Virtuoso (4000+), Ambassador (7000+)

CREATE TABLE IF NOT EXISTS member_status (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL UNIQUE,
    total_capsules INT NOT NULL DEFAULT 0,
    original_capsules INT NOT NULL DEFAULT 0,
    vertuo_capsules INT NOT NULL DEFAULT 0,
    current_tier ENUM('Connoisseur', 'Expert', 'Master', 'Virtuoso', 'Ambassador') DEFAULT NULL,
    current_year_capsules INT NOT NULL DEFAULT 0,
    current_year_start DATE NULL,
    highest_tier_achieved ENUM('Connoisseur', 'Expert', 'Master', 'Virtuoso', 'Ambassador') DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_member_status_account ON member_status(account_id);
CREATE INDEX idx_member_status_tier ON member_status(current_tier);

-- =============================================================================
-- MEMBER STATUS HISTORY TABLE (yearly tier achievements)
-- =============================================================================
CREATE TABLE IF NOT EXISTS member_status_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    year INT NOT NULL,
    capsules_ordered INT NOT NULL DEFAULT 0,
    original_capsules INT NOT NULL DEFAULT 0,
    vertuo_capsules INT NOT NULL DEFAULT 0,
    order_count INT NOT NULL DEFAULT 0,
    highest_tier ENUM('Connoisseur', 'Expert', 'Master', 'Virtuoso', 'Ambassador') DEFAULT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    UNIQUE KEY unique_account_year (account_id, year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_member_status_history_account ON member_status_history(account_id);
CREATE INDEX idx_member_status_history_year ON member_status_history(year);
