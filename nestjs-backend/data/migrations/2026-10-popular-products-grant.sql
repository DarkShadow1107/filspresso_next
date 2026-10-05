-- Phase 9 V3 load test finding.
--
-- `GET /api/orders/popular` read `popular_products_cache` and returned
--   500 {"error":"permission denied for materialized view popular_products_cache"}
-- for every caller. Not load-related: it fails identically on an idle server.
--
-- The move to the least-privilege `filspresso_backend_svc` role (Phase 1) granted that
-- role on the tables it needed, but this materialized view was missed. It is owned by
-- `filspresso_user` and had no grants at all, so the application role got nothing --
-- and because the view is read-only from the application's side, SELECT is sufficient.
--
-- PLAN_NESTJS_SCALING.md noted the unreadability in passing while explaining why the
-- view was rejected as an image catalogue, but never treated it as a defect. The load
-- test surfaced it as a hard 500 on a public route.
--
-- Audit run alongside this fix: of all relations in public owned by filspresso_user,
-- this was the only one lacking SELECT for filspresso_backend_svc.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'filspresso_backend_svc') THEN
    IF EXISTS (SELECT 1 FROM pg_class c
                JOIN pg_namespace n ON n.oid = c.relnamespace
               WHERE n.nspname = 'public' AND c.relname = 'popular_products_cache') THEN
      EXECUTE 'GRANT SELECT ON popular_products_cache TO filspresso_backend_svc';
    END IF;
  END IF;
END $$;
