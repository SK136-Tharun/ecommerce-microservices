#!/usr/bin/env bash
# Creates the appuser role + appdb database on the local Postgres install,
# and loads the schema. Used for systemd / PM2 deployment modes only
# (the Docker mode does this automatically via db/init.sql).
#
# Usage: sudo ./create-db.sh
set -euo pipefail

DB_USER="${DB_USER:-appuser}"
DB_PASSWORD="${DB_PASSWORD:-change_me_strong_password}"
DB_NAME="${DB_NAME:-appdb}"

sudo -u postgres psql -v ON_ERROR_STOP=1 <<-EOSQL
    DO \$\$
    BEGIN
       IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = '${DB_USER}') THEN
          CREATE ROLE ${DB_USER} LOGIN PASSWORD '${DB_PASSWORD}';
       END IF;
    END
    \$\$;
    SELECT 'CREATE DATABASE ${DB_NAME} OWNER ${DB_USER}'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '${DB_NAME}')\gexec
EOSQL

sudo -u postgres psql -d "${DB_NAME}" -f "$(dirname "$0")/../db/init.sql"

echo ">> Database '${DB_NAME}' ready with user '${DB_USER}'."
