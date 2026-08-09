# EWB Invoice System - AI Agent Handoff

Last updated: 2026-07-17 IST.

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
- Version: `0.3.11`
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

- Local `npm audit`: 0 vulnerabilities after patching dev tooling.
- Local `npm audit --omit=dev`: 0 vulnerabilities.
- Nyx `npm audit`: 0 vulnerabilities after patching dev tooling.
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

- `server/app-session.js`: app login session, 12-hour sliding in-memory sessions (each
  authenticated request extends expiry by 12 hours from now).
- `server/admin-session.js`: admin session, 8-hour sliding in-memory sessions.
- `server/rate-limit.js`: in-memory rate limiting keyed by `req.ip` + path. App login
  10 attempts / 15 min, admin login 8 / 15 min, payment 5 / 15 min.
- Express `trust proxy` is NOT set. Behind Caddy every request's `req.ip` is `127.0.0.1`,
  so in production these limits are effectively global across all users, not per-client.
  See Known Current Risks.
- `server/secret-utils.js`: timing-safe secret comparison.
- The formula-injection hardening in `server/excel-generator.js` (`safeExcelText`) and the
  input validation in `server/input-validation.js` are committed and deployed.

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

Production Nyx database snapshot from 2026-07-17:

- Buyers: 8
- Buyers missing GSTIN: 0
- Buyers with ship-to profiles: 1
- Items: 27
- Invoices: 58
- Invoice date range: 2025-10-30 to 2026-07-03
- Unpaid invoices: 26
- Paid invoices: 32
- Invoice lines: 132
- Sequences: `2025-26` next serial 33, `2026-27` next serial 27
- Latest verified invoice: `026/2026-27`, key `026-2026-27`, date `2026-07-03`
- Generated artifacts: 58 Excel and 58 PDF files, matching the 58 DB invoices

Payment status is stored as the `is_paid` integer column on `invoices` (plus `paid_at`,
`paid_amount`, `payment_batch_note`). There is no `payment_status` column; query `is_paid`.

Earlier snapshot from 2026-06-20, kept for trend reference: 54 invoices, 22 unpaid,
123 lines, `2026-27` next serial 23, latest `022/2026-27`. That audit also recorded
2 buyers with ship-to profiles, 2 item categories, min/max line bags 0 / 568, min/max
line quantity 144 / 45072, and legacy zero bag/BPB data of 75 lines across 33 historical
invoices.

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

Production git state from 2026-07-17:

- Branch: `main`
- Remote tracking: `origin/main`
- Working tree: clean
- Commit: `b43090f`, subject `Release v0.3.5 dev audit cleanup`
- Local and Nyx are on the same commit. The v0.3.4/v0.3.5 UX and hardening work described
  elsewhere in this file as "not deployed yet" has since been released. There is no
  deployment drift as of this audit.

Production runtime:

- Node: `v22.22.2`
- App version: `0.3.5`
- App command: `/usr/bin/node server/index.js`
- App listens on: `127.0.0.1:5000`
- Caddy listens on: ports 80 and 443
- Loopback and public `/api/health` both returned `{"ok":true,"storage":"sqlite"}`.
- Public health responded in about 0.16s with HTTP 200.

systemd:

- Service: `ewb-invoice`
- State verified active/running, continuously up since 2026-06-19.
- Restart count verified as 0.
- Resident memory about 95 MB.
- Unit uses `EnvironmentFile=/home/ubuntu/ewb-invoice-system-git/.env`.
- No warning-or-worse journal entries in the last 7 days.

Caddy:

- Caddyfile route: `152.67.2.68.nip.io, invoice.yashbottles.in`
- Reverse proxy target: `127.0.0.1:5000`
- Service verified active.

Host resources from 2026-07-17:

- Root disk: 58G total, 14G used, 45G available, 24 percent used.
- Memory: 11Gi total, 9.3Gi used, 346Mi free, 2.1Gi available.
- Swap: none.
- Nyx is a shared host. A Paper Minecraft server runs under `ubuntu` with a fixed 8G JVM
  heap (`-Xms8G -Xmx8G`) and holds roughly 77 percent of system RAM. The invoice app is a
  small consumer by comparison. See the memory risk note in Known Current Risks.

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

- As of 2026-07-17 the local tree is clean and Nyx matches it at commit `b43090f` (v0.3.5).
  The hardening work that an earlier version of this file described as undeployed has
  shipped.
- Still do not assume production has local uncommitted code until deployed. Verify with
  `git status` locally and `git log --oneline -1` on Nyx rather than trusting this file.

## Backups And Google Drive Sync

Verified scripts on Nyx:

- `/home/ubuntu/backup-ewb.sh`
- `/home/ubuntu/bin/sync-generated-to-gdrive.sh`
- `/home/ubuntu/bin/watch-generated-and-sync.sh`

Verified services/timers, with their systemd scope:

The Google Drive sync units are **user units owned by `ubuntu`**, not system units. Inspect
them with `systemctl --user`, not plain `systemctl`. A plain `systemctl is-active
generated-gdrive-watch.service` reports `inactive` and `systemctl status` reports
`Unit ... could not be found` even while the units are healthy. Do not read that as an
outage.

- `generated-gdrive-watch.service` (user scope): active/running.
- `generated-gdrive-sync.timer` (user scope): active/waiting, hourly fallback.
- `generated-gdrive-sync.service` (user scope): oneshot, inactive/dead between runs, which
  is its normal resting state.
- `ewb-backup.timer` and `ewb-backup.service` (system scope, `/etc/systemd/system/`): daily
  backup at 02:30 UTC. Query these with plain `systemctl`.

Verified behavior:

- `watch-generated-and-sync.sh` uses `inotifywait` with debounce.
- `sync-generated-to-gdrive.sh` uses `rclone copy` with flock locking.
- Destination remote path: `gdrive:Backups/Yash Bottles/generated`.
- Backup script uses SQLite `.backup` and archives masters/templates/generated data.
- Daily backups are written to `/home/ubuntu/backups/ewb/<YYYYMMDD-HHMMSS>/`.
- `/home/ubuntu/ewb-private-backups/masters/` holds the pre-deploy master CSV backups
  created by `deploy-nyx.ps1`. It is a separate location from the daily backups above.

Verified on 2026-07-17:

- Hourly gdrive sync ran cleanly at 10:15, 11:16, and 12:17 UTC.
- `gdrive:Backups/Yash Bottles/generated/pdf` contains `2025-26/` and `2026-27/`.
- Daily backup ran successfully at 02:30 UTC and wrote `/home/ubuntu/backups/ewb/20260717-023004`.
- Daily backups have no retention/pruning policy and accumulate indefinitely. Root disk was
  at 24 percent, so this is not urgent, but pruning is a sensible follow-up.

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

Local verification from 2026-07-17:

- `npm test`: passed, 36 tests across 17 suites, 0 failures.

Production verification from 2026-07-17:

- `systemctl is-active ewb-invoice`: active.
- `systemctl is-active caddy`: active.
- Loopback `/api/health`: ok.
- Public `https://invoice.yashbottles.in/api/health`: HTTP 200, ok, about 0.16s.
- `npm audit --omit=dev`: 0 vulnerabilities.
- Generated artifacts and DB invoice records matched exactly at 58/58/58.
- Daily backup and hourly Google Drive sync both verified running.

## Known Current Risks And Follow-Ups

- Raw secret values must not be written into docs or commits.
- Host memory pressure is the main live risk. Nyx has 11Gi RAM, no swap, and roughly 2.1Gi
  available, because a co-tenant Paper Minecraft server pins an 8G JVM heap. The invoice app
  is small and stable, but under a memory spike the kernel OOM killer could select it.
  Suggested mitigations, not yet applied: add a 2-4G swapfile, and set
  `OOMScoreAdjust=-500` in the `[Service]` section of `/etc/systemd/system/ewb-invoice.service`
  so the invoice app is chosen last.
- Daily backups in `/home/ubuntu/backups/ewb/` have no retention policy and grow without
  bound. Disk is at 24 percent, so this is a follow-up rather than an emergency.
- Backup restores have not been drilled. Backups are verified to exist and to open, but a
  practice restore into a temp path would confirm real recoverability.
- Sessions and rate limits are in-memory and reset on restart, so every deploy logs users
  out. Acceptable for a small office user base; revisit only if it becomes annoying.
- `trust proxy` is not set in `server/app.js`, so behind Caddy the rate limiters see every
  client as `127.0.0.1`. Brute-force protection still works (it is stricter than intended),
  but 10 bad login attempts from anyone lock ALL users out of app login for 15 minutes.
  Fix is one line, `app.set('trust proxy', 'loopback')`, plus a test.
- `server/eway-core.js` opens its own short-lived SQLite connections per request and does
  not set `busy_timeout` on them (the main connection sets 5000 ms). Concurrent writes
  could surface SQLITE_BUSY errors on E-way endpoints.
- The E-way routes and `/api/invoices/mark-paid` do not `await dbReady` before touching the
  database. A request in the first moments after process start could hit an uninitialized
  handle. All other API routes await it.
- Server-side, editing an invoice allows an invoice-date change within the same financial
  year; artifacts are then written under the new month folder and the old month's files are
  not deleted. The UI currently prevents this by disabling the date field while editing, so
  the gap is reachable only via direct API calls.
- `src/App.jsx` (about 1350 lines) and `src/App.css` are large and would benefit from careful
  extraction over time.
- No React error boundary exists.
- Tokens are stored in `localStorage`.
- Some invoice sequence logic is intentionally conservative, but any change around generation
  and DB writes needs careful tests.
- Minor frontend nits found in the 2026-07-17 audit: `InvoicePreviewModal` and
  `readInvoiceDraft` key lines by item code, so an invoice with the same item on two lines
  would produce duplicate React keys; loading a legacy zero-bag line for edit silently
  defaults bags to 1 when the description regex cannot reconstruct it; and the live preview
  math skips the server's per-line rounding, so paise-level display drift is possible.
- Avoid broad refactors unless the user explicitly asks.

Stale claims removed from this list after the 2026-07-17 code audit, kept here so future
agents do not re-add them: `InvoicePreviewModal` now uses the `useModalTrap` focus trap;
`.delete-modal-detail` now uses `var(--ink)` which is defined in `src/index.css`;
`ewayDistanceOverrides` IS used (it backs the manual distance-entry inputs in
`useEwayReadiness`); no hardcoded buyer codes exist in frontend E-way warnings (the only
hardcoded location logic is the server-side `MIDC LONAND` distance default in
`eway-core.js`).

## Git State At Audit Time

As of 2026-07-17:

- Local branch: `main`, tracking `origin/main`.
- Local working tree: clean.
- Local commit: `b43090f`, `Release v0.3.5 dev audit cleanup`.
- Nyx commit: `b43090f`, working tree clean. Local and production are in sync.

The modified and untracked files listed here in the 2026-06-20 audit, including
`server/input-validation.js` and this file itself, have all since been committed.

If a future audit finds an unexpectedly dirty tree, do not revert user or prior-agent
changes just to get a clean tree. Work with them.

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
