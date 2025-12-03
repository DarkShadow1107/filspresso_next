-- Migration: Add 'service' to order_items.product_type ENUM
-- This allows repair services to be stored as order items

ALTER TABLE order_items 
MODIFY COLUMN product_type ENUM('capsule', 'machine', 'accessory', 'subscription', 'service') NOT NULL;
