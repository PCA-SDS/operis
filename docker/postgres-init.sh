#!/bin/bash
set -e

# Enable the extensions the platform relies on in the default database.
# pg_trgm backs chat message search: typo tolerance, and substring matching for
# Chinese and Japanese, which the `simple` text-search config cannot segment.
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOSQL

echo "extensions enabled in database: $POSTGRES_DB"

# Also enable in template1 so all new databases get it automatically
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "template1" <<-EOSQL
    CREATE EXTENSION IF NOT EXISTS vector;
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
EOSQL

echo "extensions enabled in template1 (all new databases will inherit them)"
