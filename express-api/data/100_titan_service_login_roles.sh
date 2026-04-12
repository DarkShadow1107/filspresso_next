#!/bin/sh
set -eu

psql_exec() {
    psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" "$@"
}

upsert_service_login_role() {
    service_user="$1"
    password_file="$2"
    parent_role="$3"

    if [ -z "$service_user" ] || [ -z "$password_file" ] || [ ! -f "$password_file" ]; then
        return 0
    fi

    service_password="$(tr -d '\r\n' < "$password_file")"
    if [ -z "$service_password" ]; then
        echo "Skipping service role ${service_user}: password file is empty (${password_file})"
        return 0
    fi

    psql_exec \
        -v service_user="$service_user" \
        -v service_password="$service_password" \
        -v parent_role="$parent_role" <<'EOSQL'
DO $$
BEGIN
    EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', :'service_user', :'service_password');
EXCEPTION
    WHEN duplicate_object THEN
        EXECUTE format('ALTER ROLE %I LOGIN PASSWORD %L', :'service_user', :'service_password');
END $$;

DO $$
BEGIN
    EXECUTE format('GRANT %I TO %I', :'parent_role', :'service_user');
EXCEPTION
    WHEN undefined_object THEN
        RAISE NOTICE 'Parent role % does not exist yet; skipping grant for %', :'parent_role', :'service_user';
END $$;
EOSQL
}

upsert_service_login_role "${BACKEND_DB_USER:-}" "${BACKEND_DB_PASSWORD_FILE:-}" "filspresso_backend_rw"
upsert_service_login_role "${AI_DB_USER:-}" "${AI_DB_PASSWORD_FILE:-}" "filspresso_ai_ro"
upsert_service_login_role "${INVOICE_DB_USER:-}" "${INVOICE_DB_PASSWORD_FILE:-}" "filspresso_invoice_ro"
upsert_service_login_role "${KOTLIN_DB_USER:-}" "${KOTLIN_DB_PASSWORD_FILE:-}" "filspresso_kotlin_ro"
upsert_service_login_role "${SECURITY_WRITER_DB_USER:-}" "${SECURITY_WRITER_DB_PASSWORD_FILE:-}" "filspresso_security_writer"
upsert_service_login_role "${SECURITY_READER_DB_USER:-}" "${SECURITY_READER_DB_PASSWORD_FILE:-}" "filspresso_security_reader"
