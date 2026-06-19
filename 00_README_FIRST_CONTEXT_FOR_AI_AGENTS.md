# EWB Invoice System - AI Agent Handoff

Last updated: 2026-06-20 IST.

This is the first file an AI agent should read for this project. It summarizes the local
repository, the live Nyx deployment, runtime data shape, verification results, and the
rules that matter for safe changes. If anything here differs from source code or live
Nyx configuration, treat the source code and Nyx as authoritative, then update this file.

## Hard Rules

- Do not commit `.env`, database files, generated invoices, logs, backups, or raw secrets.
- Do not write actual passwords or secret values into this file, `README.md`, tests, commits,
  issue text, screenshots, or chat summaries.
- Production secrets live only on Nyx in `/home/ubuntu/ewb-invoice-system-git/.env`.
- Production invoice data is private. Read it only when needed, summarize counts and shape,
  and avoid copying buyer/item/invoice details into docs unless explicitly required.
- Generated Excel/PDF files are runtime artifacts, not source files.
- Before deployment, preserve masters and SQLite with the existing backup flow.
- Latest invoice deletion must remain gapless and latest-only.
- If touching invoice math, numbering, payment, auth, export, or E-way behavior, run tests
  before declaring the work done.

## Project Purpose

Yash Bottles EWB Invoice System is a lightweight tax invoice generator for Yash Bottles.
It supports office LAN usage on Windows and production usage on Nyx at:

- `https://invoice.yashbottles.in`

Core behavior:

- Generates GST tax invoices with 18 percent GST, split as 9 percent CGST and 9 percent SGST.
- Maintains financial-year-scoped invoice numbering in the form `NNN/YYYY-YY`.
- Resets invoice numbering every April 1.
- Produces both Excel files from a styled template and vector PDF invoices.
- Stores buyers, items, ship-to profiles, invoice history, payment status, and E-way data in SQLite.
- Supports E-way bill readiness checks and bulk JSON export.
- Tracks service fee/payment clearing for unpaid invoices.
- Runs local LAN through `start-lan-server.bat` and production through systemd on Nyx.

## Stack And Commands

Package:

- Name: `invoice-web-app`
- Version: `0.3.4`
- Module type: ESM
- Required Node engine: `>=22.5.0`

Important commands:

- `npm run dev`: server and Vite client together.
- `npm run dev:server`: Express server only.
- `npm run dev:client`: Vite client only.
- `npm run build`: production frontend build.
- `npm start`: start `server/index.js`.
- `npm test`: Node test runner.
- `npm run test:ui`: Playwright UI regression suite through `scripts/run-ui-tests.mjs`.

Top-level dependencies used by the app:

- Server/export: `express`, `cors`, `csv-parse`, `exceljs`, `pdf-lib`.
- Frontend: `react`, `react-dom`, `vite`, `@vitejs/plugin-react`.
- Testing/dev: `@playwright/test`, `concurrently`, Babel parser/traverse helpers.

Known verified dependency state:

- Local `npm audit --omit=dev`: 0 vulnerabilities.
- Nyx `npm audit --omit=dev`: 0 vulnerabilities.

## Directory Map

- `server/`: Express API, auth, SQLite, invoice generation, payment, E-way logic.
- `src/`: React app and UI components.
- `tests/`: Playwright UI tests.
- `scripts/`: UI test runner and support scripts.
- `data/templates/Invoice Temp.xlsx`: committed Excel template.
- `data/masters/.gitkeep`: keeps the private masters folder shape.
- `data/masters/*.csv`: private runtime masters, ignored by git.
- `data/invoice-app.sqlite`: private runtime SQLite database, ignored by git.
- `generated/`: private generated Excel/PDF invoices, ignored by git.
- `dist/`: Vite build output, ignored by git.
- `test-results/` and `playwright-report/`: ignored test output.
- `deploy-nyx.ps1`: Windows-side Nyx deployment script.
- `start-lan-server.bat`: Windows office LAN launcher.
- `.env.example`: placeholder-only environment example.

The root one-off audit files `deep_code_review*.md`, `final_audit_report.md`, and
`scratch-search-beer.js` were removed because they were untracked scratch/review artifacts.

## Secrets And Credentials

Actual secret values are intentionally not stored here.

Production secret location:

- Host: `nyx`
- Path: `/home/ubuntu/ewb-invoice-system-git/.env`
- Owner/mode verified: `ubuntu:ubuntu`, mode `600`
- Loaded by: `/etc/systemd/system/ewb-invoice.service` through `EnvironmentFile=.../.env`

Required keys:

- `HOST`
- `PORT`
- `APP_USERNAME`
- `APP_PASSWORD`
- `ADMIN_PASSWORD`
- `PAYMENT_PASSWORD`
- `INVOICE_SERVICE_FEE`

Redacted production verification from 2026-06-20:

- `HOST`: set, length 9
- `PORT`: set, length 4
- `APP_USERNAME`: set, length 6
- `APP_PASSWORD`: set, length 11
- `ADMIN_PASSWORD`: set, length 24
- `PAYMENT_PASSWORD`: set, length 24
- `INVOICE_SERVICE_FEE`: set, length 3

Local state:

- No local `.env` was present during the audit.
- `.env.example` contains placeholders only.

Safe secret update procedure:

1. SSH to Nyx.
2. Edit `/home/ubuntu/ewb-invoice-system-git/.env` directly on the host.
3. Keep file permissions at `600`.
4. Restart with `sudo systemctl restart ewb-invoice`.
5. Verify with `sudo systemctl is-active ewb-invoice` and `/api/health`.

Never paste the secret values into this document after changing them. If an agent needs to
record freshness, record only key presence, length, modified time, or rotation date.

## Server Architecture

Entry point:

- `server/index.js`: starts the app.
- `server/app.js`: Express app, security headers, CORS, JSON parsing, auth gates, API routes,
  static `dist` serving, and error handling.

Configuration:

- `server/config.js`: paths, `HOST`, `PORT`, required secrets, `INVOICE_SERVICE_FEE`,
  `maxLineItems = 8`.
- Default host in source is `0.0.0.0`; production overrides to loopback through `.env`.

Auth and security:

- `server/app-session.js`: app login session, 12-hour in-memory sessions.
- `server/admin-session.js`: admin session, 8-hour in-memory sessions.
- `server/rate-limit.js`: in-memory rate limiting for sensitive auth/payment flows.
- `server/secret-utils.js`: timing-safe secret comparison.
- Local uncommitted hardening exists in `server/app.js`, `server/input-validation.js`,
  `server/excel-generator.js`, `server/invoice-formatting.js`, and related tests.

Invoice core:

- `server/invoice-core.js`: startup initialization, directories, DB schema, migrations,
  seeding, invoice payload building, generation flow, file rename/save flow.
- `server/invoice-repository.js`: SQL CRUD, transactions, history, payment summary,
  latest-only deletion, master data operations, ship-to profiles.
- `server/invoice-rules.js`: financial year logic, line calculations, GST totals, rounding,
  max bags guard.
- `server/excel-generator.js`: ExcelJS template mutation.
- `server/pdf-generator.js`: vector PDF generation with `pdf-lib`.
- `server/eway-core.js`: E-way readiness and bulk JSON export.

Frontend:

- `src/App.jsx`: main app state, app login, API wrapper, navigation, invoice creation,
  history, admin panels, payment modal, E-way flows.
- `src/invoice-utils.js`: frontend calculations and formatting helpers.
- `src/components/`: history, edit, preview, payment, admin, toast, changelog screens.
- `src/hooks/`: E-way readiness and supporting UI hooks.

## Database And Runtime Data

SQLite database path:

- Local: `data/invoice-app.sqlite`
- Nyx: `/home/ubuntu/ewb-invoice-system-git/data/invoice-app.sqlite`

SQLite runtime settings:

- WAL mode enabled.
- Busy timeout configured.
- Startup migrations add missing columns/tables for older DBs.

Main tables:

- `buyers`
- `buyer_ship_to_options`
- `items`
- `invoice_sequences`
- `invoices`
- `invoice_lines`
- `app_settings`
- `eway_invoice_distances`
- `eway_buyer_distances`
- `eway_ambiguous_buyer_distances`

Production Nyx database snapshot from 2026-06-20:

- Buyers: 8
- Buyers missing GSTIN: 0
- Buyers with ship-to profiles: 2
- Items: 27
- Item categories: 2
- Invoices: 54
- Invoice date range: 2025-10-30 to 2026-06-20
- Unpaid invoices: 22
- Paid invoices: 32
- Invoice lines: 123
- Min/max line bags: 0 / 568
- Min/max line quantity: 144 / 45072
- Sequences: `2025-26` next serial 33, `2026-27` next serial 23
- Latest verified invoice: `022/2026-27`, key `022-2026-27`, date `2026-06-20`
- Legacy zero bag/BPB data: 75 lines across 33 historical invoices
- Generated artifacts: 54 Excel and 54 PDF files, with DB/artifact consistency verified

Local database snapshot from 2026-06-20:

- Buyers: 8
- Items: 26
- Invoices: 45
- Invoice lines: 99
- Invoice date range: 2025-10-30 to 2026-05-21
- Unpaid invoices: 13
- Paid invoices: 32
- Sequences: `2025-26` next serial 33, `2026-27` next serial 14
- Legacy zero bag/BPB data: 75 lines across 33 historical invoices
- Generated artifacts: 45 Excel and 45 PDF files, with DB/artifact consistency verified

## Invoice Rules

Source of truth: `server/invoice-rules.js`.

Financial year:

- April through March.
- `deriveFinancialYearSuffix()` returns `YYYY-YY`.
- Invoice display number is `NNN/YYYY-YY`.
- Invoice key is normalized as `NNN-YYYY-YY`.

Line calculation:

- `bags` must be finite and greater than zero for new invoices.
- Current local source also caps `bags` at `100000`.
- `quantity = bags * bottles_per_bag`
- `taxable_rate = gross_rate - non_taxable_rate`
- `amount = quantity * gross_rate`
- `non_taxable_value = quantity * non_taxable_rate`
- `taxable_value = quantity * taxable_rate`
- Monetary values round to 2 decimals using `roundCurrency`.

Totals:

- `cgst = taxable_value * 0.09`
- `sgst = taxable_value * 0.09`
- `taxable_after_gst = taxable_value + cgst + sgst`
- `total = non_taxable_value + taxable_after_gst`

Important history behavior:

- Historical invoices keep saved line snapshots and totals.
- Preview should use saved lines/totals where available, not recalculate from current masters.
- Legacy zero-bag/BPB rows exist and must remain readable.

## API Surface

Core route groups in `server/app.js`:

- App auth: login, session checks.
- Admin auth: admin login and protected master-data operations.
- Invoice: generate, history, draft/edit read, delete latest, downloads.
- Payment: payment summary and paid marking protected by payment password/session.
- Masters: buyers, items, ship-to profiles.
- E-way: readiness, distance overrides, bulk JSON export.
- Health/static: health check, Vite build output.

Download routes must sanitize header filenames and only serve expected generated files.

## Excel And PDF Output

Template:

- `data/templates/Invoice Temp.xlsx`
- Worksheet: `Temp`
- Local verification: row count 37, column count 10, portrait, paper size 9, fit-to-page,
  zoom 115.

Excel generator:

- Writes invoice metadata, buyer, ship-to, GSTIN, vehicle, line rows, totals.
- Clears/writes item rows 13 through 20.
- Uses template styling and number formats.
- Current local hardening protects Excel text fields against formula injection.

PDF generator:

- Pure vector PDF from `pdf-lib`.
- Does not use Puppeteer.
- Stores generated PDFs under `generated/pdf/<financial-year>/<mm-MonthName>/`.

Artifact layout:

- Excel: `generated/excel/<financial-year>/<mm-MonthName>/`
- PDF: `generated/pdf/<financial-year>/<mm-MonthName>/`

Production artifact verification from 2026-06-20:

- No missing Excel files for DB invoices.
- No missing PDF files for DB invoices.
- No orphan Excel/PDF artifacts detected.
- XLSX files passed zip/workbook open checks.
- PDF marker checks passed.

## E-way Behavior

Source of truth: `server/eway-core.js`.

Behavior:

- Uses supplier defaults in code.
- Reads invoice, buyer, ship-to, line, and distance data from SQLite.
- Computes readiness for E-way export.
- Supports invoice-level and buyer-level distance overrides.
- Tracks ambiguous buyer distances separately.
- Exports bulk JSON for eligible invoices.
- Supports bill-to/ship-to transport behavior and state/destination extraction.

Current caveat:

- `server/eway-core.js` opens its own SQLite connection. If lock contention appears,
  consider sharing a connection or applying equivalent busy-timeout handling there.

## Nyx Production Deployment

Production host:

- SSH alias: `nyx`
- Hostname verified: `nyx`
- App directory: `/home/ubuntu/ewb-invoice-system-git`
- Public URL: `https://invoice.yashbottles.in`
- Process manager: systemd service `ewb-invoice`
- Reverse proxy: Caddy

Production git state from 2026-06-20:

- Branch: `main`
- Remote tracking: `origin/main`
- Working tree: clean
- Commit: `dd1c1eb`
- Commit subject before this UX/hardening pass: `Fix historical invoice preview inconsistencies, legacy bags, and separators (v0.3.3)`

Production runtime:

- Node: `v22.22.2`
- npm: `10.9.7`
- App version before this UX/hardening pass: `0.3.3`
- App command: `/usr/bin/node server/index.js`
- App listens on: `127.0.0.1:5000`
- Caddy listens on: ports 80 and 443
- Health endpoint returned: `{"ok":true,"storage":"sqlite"}`

systemd:

- Service: `ewb-invoice`
- State verified active/running.
- Restart count verified as 0 during audit.
- Unit uses `EnvironmentFile=/home/ubuntu/ewb-invoice-system-git/.env`.

Caddy:

- Caddyfile route: `152.67.2.68.nip.io, invoice.yashbottles.in`
- Reverse proxy target: `127.0.0.1:5000`
- Config validation passed during audit.

Host resources from 2026-06-20:

- Root disk: 58G total, 15G used, 44G available, 25 percent used.
- Memory: 11Gi total, 9.0Gi used, 606Mi free, 2.4Gi available.
- Swap: none.

## Deployment Flow

Windows deploy script:

- `deploy-nyx.ps1`
- Optional `-Push` first runs `git push`.
- Remote flow runs on `nyx`.

Remote deployment steps:

1. Verify private master CSV files exist.
2. Create `/home/ubuntu/ewb-private-backups/masters/pre-deploy-<timestamp>`.
3. Copy master CSV files into the backup directory.
4. If SQLite DB exists, run `sqlite3 ".backup"` into the same backup directory.
5. `git fetch`, `git checkout main`, and `git pull --ff-only origin main`.
6. Ensure master CSV files still exist.
7. Run `npm ci`.
8. Run `npm run build`.
9. Source `.env`.
10. Run `node --test`.
11. Restart `ewb-invoice`.
12. Verify service active.

Important:

- Local working tree currently contains uncommitted hardening changes that are not deployed
  to Nyx yet.
- Do not assume production has local uncommitted code until deployed.

## Backups And Google Drive Sync

Verified scripts on Nyx:

- `/home/ubuntu/backup-ewb.sh`
- `/home/ubuntu/bin/sync-generated-to-gdrive.sh`
- `/home/ubuntu/bin/watch-generated-and-sync.sh`

Verified services/timers:

- `generated-gdrive-watch.service`: active/running.
- `generated-gdrive-sync.timer`: active/waiting hourly fallback.

Verified behavior:

- `watch-generated-and-sync.sh` uses `inotifywait` with debounce.
- `sync-generated-to-gdrive.sh` uses `rclone copy` with flock locking.
- Destination remote path: `gdrive:Backups/Yash Bottles/generated`.
- Latest audit saw the newest invoice PDF/XLSX copied to Google Drive.
- Backup script uses SQLite `.backup` and archives masters/templates/generated data.
- Latest backup inspected had valid DB copy and generated/data tarball.

## Local Office LAN Launcher

File: `start-lan-server.bat`.

Behavior:

- Defaults `PORT=5000`, `HOST=0.0.0.0`, `KEEP_AWAKE=1`.
- Prompts for missing app/admin/payment passwords.
- Defaults app username in source, but credentials should still be treated as private.
- Installs dependencies if `node_modules` is missing.
- Builds frontend before start.
- Can continue with an existing build if build fails and `dist/index.html` exists.
- Prints local and Wi-Fi URLs.
- Starts a keep-awake helper while the server runs.

## Verification Results

Local verification from 2026-06-20:

- `npm test`: passed, 36 tests across 17 suites.
- `npm run build`: passed.
- `npm run test:ui`: passed, 12 Playwright tests.
- UI test command exited 0, but Windows/Node printed a `UV_HANDLE_CLOSING` assertion after
  successful completion. Treat this as a runner/platform cleanup issue unless behavior changes.
- Local DB and generated artifacts had exact consistency.

Production verification from 2026-06-20:

- `systemctl is-active ewb-invoice`: active.
- `systemctl is-active caddy`: active.
- Loopback `/api/health`: ok.
- Public `/api/health`: ok.
- Caddy config validation: passed.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Generated artifacts and DB invoice records matched exactly.

## Known Current Risks And Follow-Ups

- Raw secret values must not be written into docs or commits.
- Production should receive the local UX, accessibility, validation, backup, and hardening changes
  only after tests pass and the Nyx deploy flow completes.
- Sessions and rate limits are in-memory and reset on restart.
- `src/App.jsx` and `src/App.css` are large and would benefit from careful extraction over time.
- No React error boundary exists.
- Tokens are stored in `localStorage`.
- E-way has a separate DB connection.
- Some invoice sequence logic is intentionally conservative, but any change around generation
  and DB writes needs careful tests.
- `InvoicePreviewModal` lacks a focus trap and has some inline styling.
- There is a known CSS variable issue around `.delete-modal-detail` using `var(--text)`.
- Some frontend E-way warnings rely on hardcoded buyer codes.
- `ewayDistanceOverrides` state appears unused by the current UI.
- Avoid broad refactors unless the user explicitly asks.

## Git State At Audit Time

Local branch:

- `main...origin/main`

Modified files already present before this README cleanup:

- `deploy-nyx.ps1`
- `server/app.js`
- `server/eway-core.js`
- `server/excel-generator.js`
- `server/invoice-core.js`
- `server/invoice-formatting.js`
- `server/invoice-repository.js`
- `server/invoice-rules.js`
- `server/security-and-eway.test.js`

Untracked files already present before this README cleanup:

- `00_README_FIRST_CONTEXT_FOR_AI_AGENTS.md`
- `server/input-validation.js`

Do not revert user or prior-agent changes just to get a clean tree. Work with them.

## Agent Operating Notes

- Read source before changing behavior.
- Prefer existing helpers and repo patterns.
- Keep edits scoped.
- Use `rg` for search.
- Use `apply_patch` for manual edits.
- Do not delete runtime data, generated invoices, backups, or private masters.
- If changing production, inspect Nyx live state first and preserve backups.
- If asked for "latest passwords", document only secret locations, keys, freshness, lengths,
  and rotation procedure unless the user explicitly asks to rotate them on the host.
