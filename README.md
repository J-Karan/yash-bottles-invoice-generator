# Invoice Web App

Invoice generation app for Yash Bottles with a React frontend and Express + SQLite backend.

## Data Inputs

- `data/masters/Buyers_Master.csv`
- `data/masters/Items_Master.csv`
- `data/templates/Invoice Temp.xlsx`

On first run, CSV data seeds SQLite automatically.

## Backend Refactor (Current Structure)

Server code is now split into focused modules:

- `server/index.js` - server entrypoint
- `server/app.js` - express app and routes
- `server/invoice-core.js` - DB, invoice history, Excel/PDF generation
- `server/invoice-rules.js` - pure invoice math and financial-year rules
- `server/seed-data.js` - first-run operational defaults for special Ship-To and E-way distances
- `server/rate-limit.js` - in-memory rate limiting for password-protected actions
- `server/admin-session.js` - admin token session middleware
- `server/config.js` - runtime paths and config

## Local Run

Use Node.js 22.5.0 or newer. The backend uses the built-in `node:sqlite` module.

Install dependencies:

```powershell
npm install
```

Run frontend + backend:

```powershell
$env:ADMIN_PASSWORD="your-admin-password"
$env:PAYMENT_PASSWORD="your-payment-password"
npm run dev
```

Open:

```text
http://localhost:5173
```

Run tests:

```powershell
npm test
```

## Production Run

Build frontend:

```powershell
npm run build
```

Start server:

```powershell
$env:ADMIN_PASSWORD="your-admin-password"
$env:PAYMENT_PASSWORD="your-payment-password"
npm start
```

Open:

```text
http://localhost:5000
```

## Windows LAN Run (.bat)

Use:

```text
start-lan-server.bat
```

Before running the batch file, set both required passwords in the same terminal:

```powershell
set ADMIN_PASSWORD=your-admin-password
set PAYMENT_PASSWORD=your-payment-password
start-lan-server.bat
```

This script:

- builds frontend
- starts Express server on `HOST=0.0.0.0` and `PORT=5000`
- prints local and Wi-Fi URLs

From another phone/laptop on the same Wi-Fi, open:

```text
http://<your-pc-ip>:5000
```

Example:

```text
http://192.168.1.23:5000
```

If it does not open on another device:

- ensure both devices are on same Wi-Fi
- allow Node.js on Windows Firewall (Private network)
- check your PC IPv4 using `ipconfig`

## Generated Files (Updated)

Generated output is now split for clarity:

- Excel: `generated/excel/<financial-year>/<mm-MonthName>/`
- PDF: `generated/pdf/<financial-year>/<mm-MonthName>/`

API download links now return:

- `/downloads/excel/<financial-year>/<mm-MonthName>/<invoice>.xlsx`
- `/downloads/pdf/<financial-year>/<mm-MonthName>/<invoice>.pdf`

Example:

- `/downloads/excel/2026-27/04-April/001-2026-27.xlsx`
- `/downloads/pdf/2026-27/04-April/001-2026-27.pdf`

The frontend now includes an **Invoice History** tab to review previously generated invoices
and open available Excel/PDF files.

## Admin Access

- Admin password endpoint: `POST /api/admin/login`
- `ADMIN_PASSWORD` is required before server startup
- Payment confirmation uses `PAYMENT_PASSWORD` from environment
- Admin login and payment confirmation attempts are rate-limited in memory

Use `.env.example` as a template.

## Operational Defaults

Special Ship-To options and E-way distance defaults are seeded into SQLite on first run:

- `buyer_ship_to_options`
- `eway_invoice_distances`
- `eway_buyer_distances`
- `eway_ambiguous_buyer_distances`

After seeding, update these tables instead of editing JavaScript constants.

## Financial-Year Invoice Numbering

Invoice numbering is financial-year scoped (`NNN/YYYY-YY`) and starts from `001` for each year.

If this app opens an older database where numbering was not reset by financial year, it runs a one-time
normalization that resequences invoices per year and regenerates invoice files with updated keys.

## GitHub Hosting Readiness

This project is now ready to push to GitHub cleanly:

- Runtime artifacts are ignored (`generated/`, SQLite files under `data/`, `dist/`, logs, debug files)
- Environment config template added (`.env.example`)
- Build/start scripts are already in `package.json`

Important: GitHub Pages cannot host this backend (it only serves static sites).  
Use a Node host (for example Render/Railway/Fly/VM) connected to your GitHub repo.
