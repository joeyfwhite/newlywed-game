#!/usr/bin/env bash
# TEST ONLY. Runs the real schema against a throwaway Postgres database
# that mimics Supabase, then runs the security tests.
# Usage: PGHOST=/tmp PGPORT=54329 PGUSER=postgres tests/run_sql_tests.sh
set -euo pipefail
cd "$(dirname "$0")"
DB=${TEST_DB:-newlywed_test}
psql -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase_stub.sql
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../supabase/schema.sql
# Run the schema a second time to prove it is safe to re-run.
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f ../supabase/schema.sql
psql -v ON_ERROR_STOP=1 -d "$DB" -f security_tests.sql
