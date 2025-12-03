-- Migration: Add discount columns to orders table
-- Run this to add member tier discount tracking to orders

ALTER TABLE orders 
ADD COLUMN member_tier VARCHAR(50) DEFAULT NULL AFTER notes,
ADD COLUMN discount_percent DECIMAL(5,2) DEFAULT 0.00 AFTER member_tier,
ADD COLUMN discount_amount DECIMAL(10,2) DEFAULT 0.00 AFTER discount_percent;

-- Add index for member tier analytics
CREATE INDEX idx_orders_member_tier ON orders(member_tier);
