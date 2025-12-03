-- Filspresso_session.sql
-- SQLTools session for the Filspresso project
-- This file contains helpful queries to inspect tables and foreign key relations
-- Execute any statement or select a statement and "Run Selected Query" (SQLTools)

-- 1) Show all tables in the filspresso database
SHOW TABLES;

-- 2) Schema summary with approximate row counts and size (useful for overview)
SELECT table_name, table_rows, ROUND(data_length/1024/1024,2) AS data_mb, ROUND(index_length/1024/1024,2) AS idx_mb
FROM information_schema.tables
WHERE table_schema = 'filspresso'
ORDER BY table_name;

-- 3) Columns for all tables, ordered by table and ordinal position
SELECT table_name, column_name, ordinal_position,
        column_type, is_nullable, column_default, column_key, extra
FROM information_schema.columns
WHERE table_schema = 'filspresso'
ORDER BY table_name, ordinal_position;

-- 4) Foreign key constraints / relationships (child -> parent)
SELECT
    kcu.constraint_name,
    kcu.table_name AS child_table,
    kcu.column_name AS child_column,
    kcu.referenced_table_name AS parent_table,
    kcu.referenced_column_name AS parent_column
FROM information_schema.key_column_usage kcu
WHERE kcu.constraint_schema = 'filspresso'
    AND kcu.referenced_table_name IS NOT NULL
ORDER BY child_table;

-- 5) Referential constraint detail (enforceable rules)
SELECT
    rc.constraint_name,
    rc.unique_constraint_name as parent_constraint,
    rc.update_rule,
    rc.delete_rule
FROM information_schema.referential_constraints rc
WHERE rc.constraint_schema = 'filspresso'
ORDER BY rc.constraint_name;

-- 6) Show indexes for tables (example: repairs)
SELECT table_name, index_name, column_name, non_unique, seq_in_index
FROM information_schema.statistics
WHERE table_schema = 'filspresso'
ORDER BY table_name, index_name, seq_in_index;

-- 7) Quick data preview statements (adjust LIMIT if needed)
-- Orders (latest 50):
SELECT id, account_id, order_number, status, total, created_at
FROM orders
ORDER BY created_at DESC
LIMIT 50;

-- Repairs (latest 50):
SELECT id, account_id, order_id, machine_id, machine_name, repair_type, status, estimated_cost, actual_cost, pickup_date, completion_date, payment_card_id
FROM repairs
ORDER BY created_at DESC
LIMIT 50;

-- Order items for a specific order (replace ORDER_ID):
-- SELECT * FROM order_items WHERE order_id = 1234 LIMIT 200;

-- User cards (saved payment methods):
SELECT id, account_id, card_type, card_last_four, is_default, created_at
FROM user_cards
ORDER BY account_id, is_default DESC, id DESC;

SELECT id, username, email, name, subscription, created_at
FROM accounts
ORDER BY created_at DESC
LIMIT 100;

-- 8) Build a mapping (graph) output for relationships (useful for ER diagram generators)
SELECT kcu.table_name AS child_table,
        kcu.column_name AS child_column,
        kcu.referenced_table_name AS parent_table,
        kcu.referenced_column_name AS parent_column
FROM information_schema.key_column_usage kcu
WHERE kcu.constraint_schema = 'filspresso'
    AND kcu.referenced_table_name IS NOT NULL
ORDER BY child_table, parent_table;

-- 9) Example: join across relations to see data connections
-- orders -> order_items -> repairs
SELECT o.id AS order_id, o.order_number, oi.id AS item_id, oi.product_type, oi.product_name,
        r.id AS repair_id, r.machine_name, r.status AS repair_status
FROM orders o
LEFT JOIN order_items oi ON oi.order_id = o.id
LEFT JOIN repairs r ON r.order_id = o.id
WHERE o.created_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
ORDER BY o.created_at DESC
LIMIT 200;

-- 10) Custom: Show FK counts by table (how many FKs referencing each parent table)
SELECT referenced_table_name AS parent_table, COUNT(*) AS referencing_count
FROM information_schema.key_column_usage
WHERE constraint_schema = 'filspresso'
    AND referenced_table_name IS NOT NULL
GROUP BY referenced_table_name
ORDER BY referencing_count DESC;

-- 11) Generate sample SELECT statements for all tables (copy & paste to run individually)
SELECT CONCAT('/* ', table_name, ' */\nSELECT * FROM `', table_schema, '`.`', table_name, '` LIMIT 20;') AS sample_select
FROM information_schema.tables
WHERE table_schema = 'filspresso'
    AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 12) DESCRIBE all tables (useful to know what's inside each table)
SELECT CONCAT('DESCRIBE `', table_schema, '`.`', table_name, '`;') AS describe_stmt
FROM information_schema.tables
WHERE table_schema = 'filspresso'
    AND table_type = 'BASE TABLE'
ORDER BY table_name;

-- 13) Pre-defined quick previews (adjust LIMIT as needed) - copy and run each block to see content separately
-- Accounts
SELECT * FROM accounts ORDER BY created_at DESC LIMIT 20;

-- Orders
SELECT * FROM orders ORDER BY created_at DESC LIMIT 20;

-- Order items
SELECT * FROM order_items ORDER BY id DESC LIMIT 20;

-- Repairs
SELECT * FROM repairs ORDER BY created_at DESC LIMIT 20;

-- User cards
SELECT * FROM user_cards ORDER BY account_id, is_default DESC, id DESC LIMIT 50;

-- Member status
SELECT * FROM member_status ORDER BY created_at DESC LIMIT 50;

-- End of session file
-- Tip: select any query and run it; to preview a table, right-click it in SQLTools Explorer and choose "Select Top 100".