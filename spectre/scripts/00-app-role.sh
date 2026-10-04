#!/bin/sh
set -eu

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set for database initialization}"
: "${APP_DB_ROLE:=spectre_app}"
: "${POSTGRES_DB:?POSTGRES_DB must be set}"

if ! psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=app_role="$APP_DB_ROLE" --set=app_password="$APP_DB_PASSWORD" --set=app_database="$POSTGRES_DB" \
    --tuples-only --no-align \
    --command "SELECT 1 FROM pg_roles WHERE rolname = :'app_role'" | grep -qx 1; then
    psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
        --set=app_role="$APP_DB_ROLE" --set=app_password="$APP_DB_PASSWORD" --set=app_database="$POSTGRES_DB" \
        --command "CREATE ROLE :\"app_role\" LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'app_password';"
fi

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=app_role="$APP_DB_ROLE" --set=app_password="$APP_DB_PASSWORD" --set=app_database="$POSTGRES_DB" <<'SQL'

ALTER ROLE :"app_role" NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS PASSWORD :'app_password';
REVOKE ALL ON DATABASE :"app_database" FROM PUBLIC;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT CONNECT ON DATABASE :"app_database" TO :"app_role";
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES IN SCHEMA public
    GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";
SQL
