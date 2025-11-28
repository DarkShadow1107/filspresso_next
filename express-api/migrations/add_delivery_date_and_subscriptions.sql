-- Migration: Add expected delivery date and user subscriptions table
-- Run this on existing databases to add the new columns and table

-- =============================================================================
-- ADD EXPECTED DELIVERY DATE TO ORDERS
-- =============================================================================
ALTER TABLE orders 
ADD COLUMN expected_delivery_date DATE NULL AFTER estimated_delivery;

-- =============================================================================
-- USER SUBSCRIPTIONS TABLE (tracks active subscriptions with renewal dates)
-- =============================================================================
CREATE TABLE IF NOT EXISTS user_subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    account_id INT NOT NULL,
    subscription_tier ENUM('free', 'basic', 'plus', 'pro', 'max', 'ultimate') NOT NULL DEFAULT 'free',
    billing_cycle ENUM('monthly', 'annual') NOT NULL DEFAULT 'monthly',
    price_ron DECIMAL(10,2) DEFAULT 0.00,
    start_date DATE NOT NULL,
    renewal_date DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE,
    auto_renew BOOLEAN DEFAULT TRUE,
    payment_method VARCHAR(50),
    card_id INT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE,
    FOREIGN KEY (card_id) REFERENCES user_cards(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_user_subscriptions_account ON user_subscriptions(account_id);
CREATE INDEX idx_user_subscriptions_renewal ON user_subscriptions(renewal_date);
CREATE INDEX idx_user_subscriptions_active ON user_subscriptions(is_active);
