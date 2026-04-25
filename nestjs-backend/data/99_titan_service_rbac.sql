-- Titan V0.74 Phase 0 RBAC bootstrap (executed on fresh database initialization)
-- Creates least-privilege role groups that can be assigned to service login roles.

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_rw') THEN
        CREATE ROLE filspresso_backend_rw NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_ai_ro') THEN
        CREATE ROLE filspresso_ai_ro NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_invoice_ro') THEN
        CREATE ROLE filspresso_invoice_ro NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_kotlin_ro') THEN
        CREATE ROLE filspresso_kotlin_ro NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_security_writer') THEN
        CREATE ROLE filspresso_security_writer NOLOGIN;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_security_reader') THEN
        CREATE ROLE filspresso_security_reader NOLOGIN;
    END IF;
END $$;

GRANT USAGE ON SCHEMA public TO filspresso_backend_rw, filspresso_ai_ro, filspresso_invoice_ro, filspresso_kotlin_ro;

-- Backend orchestrator requires transactional writes across commerce tables.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO filspresso_backend_rw;
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO filspresso_backend_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO filspresso_backend_rw;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT, UPDATE ON SEQUENCES TO filspresso_backend_rw;

-- Contract schemas isolate service-facing data access from broad public schema reads.
CREATE SCHEMA IF NOT EXISTS contract_ai;
CREATE SCHEMA IF NOT EXISTS contract_invoice;
CREATE SCHEMA IF NOT EXISTS contract_kotlin;

REVOKE ALL ON SCHEMA contract_ai FROM PUBLIC;
REVOKE ALL ON SCHEMA contract_invoice FROM PUBLIC;
REVOKE ALL ON SCHEMA contract_kotlin FROM PUBLIC;

GRANT USAGE ON SCHEMA contract_ai TO filspresso_ai_ro;
GRANT USAGE ON SCHEMA contract_invoice TO filspresso_invoice_ro;
GRANT USAGE ON SCHEMA contract_kotlin TO filspresso_kotlin_ro;

DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'products') THEN
        EXECUTE '
            CREATE OR REPLACE VIEW contract_ai.products_v1 AS
            SELECT id, product_id, name, description, category, price, stock, image_filename, created_at, updated_at
            FROM public.products
        ';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'machine_products') THEN
        EXECUTE '
            CREATE OR REPLACE VIEW contract_ai.machine_products_v1 AS
            SELECT id, product_id, name, description, category, price, stock, image_filename, created_at, updated_at
            FROM public.machine_products
        ';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'orders') THEN
        EXECUTE '
            CREATE OR REPLACE VIEW contract_invoice.orders_v1 AS
            SELECT id, order_number, account_id, status, subtotal, tax, shipping_cost, total,
                   charged_subtotal, charged_tax, charged_shipping_cost, charged_total,
                   currency_code, exchange_rate, conversion_fee_percent,
                   shipping_address, billing_address, created_at, updated_at
            FROM public.orders
        ';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'order_items') THEN
        EXECUTE '
            CREATE OR REPLACE VIEW contract_invoice.order_items_v1 AS
            SELECT id, order_id, product_id, product_name, quantity, unit_price, total_price,
                   product_type, product_image, created_at, updated_at
            FROM public.order_items
        ';
    END IF;

    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'accounts') THEN
        EXECUTE '
            CREATE OR REPLACE VIEW contract_kotlin.subscription_accounts_v1 AS
            SELECT id, username, email, subscription, created_at, updated_at
            FROM public.accounts
        ';
    END IF;
END $$;

GRANT SELECT ON ALL TABLES IN SCHEMA contract_ai TO filspresso_ai_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA contract_invoice TO filspresso_invoice_ro;
GRANT SELECT ON ALL TABLES IN SCHEMA contract_kotlin TO filspresso_kotlin_ro;

ALTER DEFAULT PRIVILEGES IN SCHEMA contract_ai GRANT SELECT ON TABLES TO filspresso_ai_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA contract_invoice GRANT SELECT ON TABLES TO filspresso_invoice_ro;
ALTER DEFAULT PRIVILEGES IN SCHEMA contract_kotlin GRANT SELECT ON TABLES TO filspresso_kotlin_ro;

-- Supporting services should not receive broad public schema reads.
REVOKE SELECT ON ALL TABLES IN SCHEMA public FROM filspresso_ai_ro, filspresso_invoice_ro, filspresso_kotlin_ro;
