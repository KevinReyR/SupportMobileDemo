# Actas y pagos

## Configuration and access

Director: the Actas y pagos tab supports preview, generation, range editing while GENERADA, manual sending, full payment, cancellation and PDF/Excel export. Admin: Configuracion de actas configures issuer legal name/NIT, client city and next number. Configuration is intentionally not seeded with guessed legal data.

COORDINATOR and CLIENT cannot read statements. ADMIN cannot read statement details or change their states. All table writes are denied to API roles; security-definer RPCs explicitly check active role. RLS is enabled with default deny on the new tables.

## Financial invariants

Statements use materialized sales, not current rates or costs. Monetary aggregates are PostgreSQL numeric. IVA is fixed at 19% for this version. An active partial unique index reserves each operation once. Generation locks client and operations, validates a preview hash and uses an idempotency key. Range updates and state transitions require the current updated_at value. Client sequences cannot rewind and cancelled numbers are never reused.

Snapshots preserve issuer, client, service, city and financial rows. Generated statements can change range only. ENVIADA freezes contents; PAGADA additionally freezes state and invoice. ANULADA preserves historical content and releases reservations. Paid statements cannot be cancelled. Sending is recorded manually; no email or electronic invoice is issued.

Exports fetch the statement again through the authorized RPC. Files are generated locally; no public storage object is created. Native sharing uses a temporary cache file, removed after sharing returns. Each client has its own numbering; include client identity when referencing a number.

## Validation

- `npm run typecheck` and `npm run export:web`.
- Disposable PostgreSQL fixture: `tests/sql/statement_fixture.sql`, the new migration, then `tests/sql/statements_smoke.sql` via psql with ON_ERROR_STOP. Never apply the fixture to Supabase or a shared database.
- `node tests/statements-concurrency.cjs`: expects disposable Docker container support-statements-test populated by the smoke test; two generation transactions race on the same operation.
- `node tests/statements-export.cjs`: creates synthetic multi-page PDF and Excel in tmp/statement-qa, checks numeric exports and totals.
- `node tests/statements-ui.cjs`: mocked RPC/browser test; requires esbuild and playwright-core under TEMP/support-policy-qa and Edge. Tests generation/send/pay at mobile width and desktop screenshot.

## Deployment notes

Migration 202611100001_service_statements.sql is additive and must precede web/mobile releases. No historical statements are created. Two pre-existing migration filenames were aligned with production timestamps after checking equivalent SQL; their contents were not changed. This avoids replaying migrations already applied remotely.

A complete local Supabase reset was not available: another project owns the default ports and this repository's historical first migration assumes a pre-existing base schema. Tests ran in a dedicated PostgreSQL 17 container without touching that project. Native physical-device export remains a manual acceptance check.
