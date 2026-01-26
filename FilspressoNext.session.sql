-- Filspresso Database Content Overview
-- This file contains queries to view the raw data for all tables in the filspresso database.
-- Accounts (Users)
SELECT * FROM accounts ORDER BY created_at DESC;

-- User Cards (Payment Methods)
SELECT * FROM user_cards ORDER BY created_at DESC;

-- Orders
SELECT * FROM orders ORDER BY created_at DESC;

-- Order Items
SELECT * FROM order_items ORDER BY created_at DESC;

-- Favorites
SELECT * FROM favorites ORDER BY created_at DESC;

-- Cart Items
SELECT * FROM cart_items ORDER BY created_at DESC;

-- Repairs
SELECT * FROM repairs ORDER BY created_at DESC;

-- Member Status (Loyalty Info)
SELECT * FROM member_status ORDER BY created_at DESC;

-- Member Status History
SELECT * FROM member_status_history ORDER BY created_at DESC;

-- Subscriptions
SELECT * FROM subscriptions ORDER BY created_at DESC;

-- Chat Sessions
SELECT * FROM chat_sessions ORDER BY created_at DESC;

-- Chat Messages
SELECT * FROM chat_messages ORDER BY created_at DESC;

-- IoT Commands (Machine Control)
SELECT * FROM iot_commands ORDER BY created_at DESC;

-- User Sessions
SELECT * FROM user_sessions ORDER BY created_at DESC;

-- AI Coffee Facts (Order by ID if created_at is missing)
SELECT * FROM coffee_facts; 

-- Molecules
SELECT * FROM molecules ORDER BY created_at DESC;

-- Weather Cache (Uses 'timestamp' instead of 'created_at')
SELECT * FROM weather_cache ORDER BY timestamp DESC;

-- Coffee & Machine Products
SELECT * FROM coffee_products ORDER BY created_at DESC;
SELECT * FROM machine_products ORDER BY created_at DESC;
