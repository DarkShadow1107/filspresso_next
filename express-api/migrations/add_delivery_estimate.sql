-- Migration: Add weather-based delivery estimates to orders
-- Run this SQL against your database to add the new columns

ALTER TABLE orders 
ADD COLUMN weather_condition ENUM('clear', 'rain', 'snow', 'normal') DEFAULT 'normal' AFTER notes,
ADD COLUMN estimated_delivery VARCHAR(20) DEFAULT '1-2 days' AFTER weather_condition;

-- Update existing orders to have default values
UPDATE orders SET weather_condition = 'normal', estimated_delivery = '1-2 days' WHERE weather_condition IS NULL;
