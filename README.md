# Invoice Web App

Invoice generation app for Yash Bottles with a React frontend and Express + SQLite backend.

## Data Inputs

- `Buyers_Master.csv`
- `Items_Master.csv`
- `Invoice Temp.xlsx`

On first run, CSV data seeds SQLite automatically.

## Backend Refactor (Current Structure)

Server code is now split into focused modules:

- `server/index.js` - server entrypoint
- `server/app.js` - express app and routes
- `server/invoice-core.js` - DB, business rules, Excel/PDF generation
- `server/admin-session.js` - admin token session middleware
- `server/config.js` - runtime paths and config

## Local Run

Install dependencies:

```powershell
npm install
```

Run frontend + backend:

```powershell
npm run dev
```

Open:

```text
http://localhost:5173
```

## Production Run

Build frontend:

```powershell
npm run build
```

Start server:

```powershell
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

- Excel: `generated/excel/`
- PDF: `generated/pdf/`

API download links now return:

- `/downloads/excel/<invoice>.xlsx`
- `/downloads/pdf/<invoice>.pdf`

The frontend now includes an **Invoice History** tab to review previously generated invoices
and open available Excel/PDF files.

## Admin Access

- Admin password endpoint: `POST /api/admin/login`
- Default local password fallback: `admin123`
- For deployment, set `ADMIN_PASSWORD` from environment

Use `.env.example` as a template.

## GitHub Hosting Readiness

This project is now ready to push to GitHub cleanly:

- Runtime artifacts are ignored (`generated/`, `data/`, `dist/`, logs, debug files)
- Environment config template added (`.env.example`)
- Build/start scripts are already in `package.json`

Important: GitHub Pages cannot host this backend (it only serves static sites).  
Use a Node host (for example Render/Railway/Fly/VM) connected to your GitHub repo.
