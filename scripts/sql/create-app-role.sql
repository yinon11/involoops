-- Create the non-superuser runtime role and apply the audit-log hardening
-- (the operator step KNOWN_ISSUES and 0023b_audit_log_harden.sql describe).
--
-- The app container boots as the DB owner (MIGRATE_DATABASE_URL) to run
-- migrations, then serves traffic as this role (DATABASE_URL). Because the
-- role is not the tables' owner and not superuser, the REVOKE below is a
-- real database guarantee: runtime SQL cannot UPDATE or DELETE audit rows,
-- whatever the application layer does.
--
-- Run as the cluster superuser, per environment:
--   production:  docker exec -i invoices-postgres psql -U invoices -d invoices \
--     -v app_role=invoices_app -v owner_role=invoices -v app_password='<secret>' \
--     -f - < scripts/sql/create-app-role.sql
--   sandbox:     same against invoices-sandbox-postgres with
--     -U invoices_sandbox -d invoices_sandbox \
--     -v app_role=invoices_sandbox_app -v owner_role=invoices_sandbox
--
-- Re-runnable: CREATE is guarded, ALTER/GRANT/REVOKE are idempotent.

\set ON_ERROR_STOP on

-- Create the role only if missing (\gexec runs the generated statement).
SELECT format('CREATE ROLE %I', :'app_role')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = :'app_role')
\gexec

-- Always (re)apply attributes and password.
ALTER ROLE :"app_role" WITH LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION PASSWORD :'app_password';

-- Runtime needs full CRUD on the application schema...
GRANT USAGE ON SCHEMA public TO :"app_role";
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app_role";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app_role";

-- ...including tables future migrations create (migrations run as the owner).
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app_role";
ALTER DEFAULT PRIVILEGES FOR ROLE :"owner_role" IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO :"app_role";

-- The hardening itself (0023b): the audit log is INSERT-only for runtime.
-- Guarded: on a FRESH database the table does not exist until the app's
-- first boot runs the migrations — install.sh therefore runs this file
-- twice (before boot for the role, after boot for the hardening); the
-- guard makes both runs clean.
SELECT format('REVOKE UPDATE, DELETE, TRUNCATE ON document_audit_log FROM %I', :'app_role')
WHERE EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_audit_log')
\gexec

-- Verification — expect f, then f / f / t on the privilege row (the second
-- query appears only once the table exists).
SELECT rolsuper AS is_superuser FROM pg_roles WHERE rolname = :'app_role';
SELECT format('SELECT has_table_privilege(%L, ''document_audit_log'', ''UPDATE'') AS update_priv,
       has_table_privilege(%L, ''document_audit_log'', ''DELETE'') AS delete_priv,
       has_table_privilege(%L, ''document_audit_log'', ''INSERT'') AS insert_priv',
       :'app_role', :'app_role', :'app_role')
WHERE EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'document_audit_log')
\gexec
