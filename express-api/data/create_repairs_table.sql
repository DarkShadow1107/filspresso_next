-- =============================================================================
-- REPAIRS TABLE
-- Dedicated table to track machine repair requests with full history
-- =============================================================================

-- Add 'service' type to order_items product_type if not exists
ALTER TABLE order_items MODIFY COLUMN product_type ENUM('capsule', 'machine', 'accessory', 'subscription', 'service') NOT NULL;

-- Create dedicated repairs table for detailed tracking
CREATE TABLE IF NOT EXISTS repairs (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    order_id INT NULL,
    machine_id VARCHAR(100) NOT NULL,
    machine_name VARCHAR(255) NOT NULL,
    repair_type ENUM('cleaning', 'descaling', 'pump', 'heating', 'general') NOT NULL DEFAULT 'general',
    is_warranty BOOLEAN DEFAULT FALSE,
    estimated_cost DECIMAL(10,2) DEFAULT 0.00,
    actual_cost DECIMAL(10,2) NULL,
    estimated_duration INT NOT NULL DEFAULT 3 COMMENT 'Days',
    weather_delay BOOLEAN DEFAULT FALSE,
    warranty_delay BOOLEAN DEFAULT FALSE,
    status ENUM('pending', 'received', 'diagnosing', 'repairing', 'testing', 'ready', 'completed', 'cancelled') DEFAULT 'pending',
    technician_notes TEXT,
    customer_notes TEXT,
    pickup_date DATE NULL,
    completion_date DATE NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_repairs_account ON repairs(account_id);
CREATE INDEX idx_repairs_order ON repairs(order_id);
CREATE INDEX idx_repairs_status ON repairs(status);
CREATE INDEX idx_repairs_machine ON repairs(machine_id);
CREATE INDEX idx_repairs_created ON repairs(created_at);
