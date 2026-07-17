const changeLogEntries = [
  {
    version: '0.3.7',
    title: 'UI/UX Bug-Fix & Accessibility Pass',
    changes: [
      'Delete is now disabled on invoices that cannot be deleted, instead of failing after the confirmation dialog; only the latest invoice of each financial year stays actionable.',
      'A too-short or too-long vehicle number now gets a clear length message, and the field validates format directly in the browser before submitting.',
      'Form errors scroll into view and announce to screen readers, so a failed generate is never invisible below the fold.',
      'The live preview now uses the same per-line rounding as the server, removing rare one-paisa differences against saved invoices.',
      'An expired login session now returns you to the login screen with an explanation instead of leaving dead buttons and scattered errors.',
      'The changelog is now reachable after login from the version pill in the workspace header, and deleting an invoice shows a confirmation toast.',
      'Accessibility polish: proper page heading, navigation landmark with current-view marker, larger touch targets on mobile history actions, cleaner screen-reader names for password fields, and singular/plural bag labels.',
    ],
  },
  {
    version: '0.3.6',
    title: 'Proxy-Aware Rate Limiting & Startup Hardening',
    changes: [
      'Enabled Express trust proxy for the loopback reverse proxy, so login rate limits now apply per real client instead of treating everyone behind Caddy as one shared address.',
      'Added a regression test proving repeated failed logins from one client cannot lock other clients out.',
      'Set a 5-second SQLite busy timeout on the E-way module\'s own database connections to prevent lock errors under concurrent writes.',
      'Made the E-way readiness, E-way bulk JSON, and mark-paid endpoints wait for database initialization before serving requests issued right after startup.',
    ],
  },
  {
    version: '0.3.5',
    title: 'Clean Dev Audit & Toolchain Patch',
    changes: [
      'Updated Vite and concurrently to patched dev-tooling versions so the full npm audit is clean.',
      'Made the Node test runner execute files sequentially to remove SQLite initialization races.',
      'Kept the production app on the same UX, E-way distance, preview modal, validation, and deploy safety improvements from v0.3.4.',
      'Re-ran backend, build, UI, browser smoke, and Nyx deployment verification after the dependency patch.',
    ],
  },
  {
    version: '0.3.4',
    title: 'UX, E-way Distance & Safety Polish',
    changes: [
      'Added a guided distance entry path for E-way JSON when an invoice is otherwise ready but missing transport distance.',
      'Improved Invoice History actions so preview, edit, delete, and file exports are easier to scan and less error-prone.',
      'Added keyboard focus trapping to the Invoice History preview modal for a safer accessible dialog experience.',
      'Fixed a stale CSS token in the delete confirmation detail panel.',
      'Tightened request validation, protected E-way download filenames, and preserved SQLite during Nyx deploy backups.',
    ],
  },
  {
    version: '0.3.3',
    title: 'Clean Legacy Bags & Separators (Inconsistencies Fix)',
    changes: [
      'Resolved rendering inconsistencies inside the Invoice History Preview Modal regarding item quantity, bags, and separators.',
      'Optimised the backend repository to parse legacy bags/bottles-per-bag values from description snapshots using a universal regex when legacy columns are zero.',
      'Dynamically stripped parsed inline bag metadata from returned description titles to avoid duplicate display in previews.',
      'Rendered a unified high-fidelity "Bags x" subtitle under item description titles using a consistent " x " separator.',
      'Bumped system release version to v0.3.3.',
    ],
  },
  {
    version: '0.3.2',
    title: 'Historical Preview Fix (Unknown Item Bug)',
    changes: [
      'Fixed a high-fidelity rendering bug where previewing historical and legacy invoices displayed "Unknown Item" and ₹0.00.',
      'Enforced rendering of actual saved snapshot items and invoice totals directly from the database instead of trying to dynamically recalculate them on the fly.',
      'Ensured absolute database integrity for old records while preserving real-time preview calculations for new unsaved invoices.',
      'Bumped system release version to v0.3.2.',
    ],
  },
  {
    version: '0.3.1',
    title: 'Eliminate God-Files (Split invoice-core.js)',
    changes: [
      'Extracted database CRUD helper methods, mappers, normalizers, and ship-to resolution helpers from the server-side god-file invoice-core.js into a dedicated, clean invoice-repository.js repository module.',
      'Implemented clean, modular delegation to prevent duplicate database operations and circular dependencies.',
      'Bumped system release version to v0.3.1.',
    ],
  },
  {
    version: '0.3.0',
    title: 'Calculation engine refactoring',
    changes: [
      'Centralized CGST, SGST, quantity, and total calculations into a single source of truth helper function in invoice-utils.js.',
      'Refactored workspace and preview modal to use the centralized calculations, reducing duplicate code.',
      'Bumped system release version to v0.3.0.',
    ],
  },
  {
    version: '0.2.1',
    title: 'Modal layout refinement',
    changes: [
      'Added card padding to the invoice history preview modal to prevent title text clipping.',
      'Bumped system release version to v0.2.1.',
    ],
  },
  {
    version: '0.2.0',
    title: 'Table layout refinement',
    changes: [
      'Prevented awkward text wrapping in history table column headers (e.g. Lines, Vehicle).',
      'Bumped system release version to v0.2.0.',
    ],
  },
  {
    version: '0.1.9',
    title: 'Invoice History Preview',
    changes: [
      'Added a read-only high-fidelity Invoice Preview Modal inside the Invoice History tab.',
      'Optimized real-time calculations matching the main invoice creation engine.',
      'Redesigned the history actions panel into a balanced 3-row grid layout.',
    ],
  },
  {
    version: '0.1.8',
    title: 'UI/UX bug fixes',
    changes: [
      'Fixed download grid alignment shifts in history when Excel or PDF files are missing.',
      'Prevented numeric scroll wheel increments on Number of Bags fields.',
      'Mitigated horizontal scrolling by upgrading responsive layout threshold to 960px.',
      'Improved legibility contrast for locked date inputs to meet accessibility standards.',
      'Added early E-way distance warning banner inside the invoice creation form.',
      'Integrated a fast "Clear Search" button inside the invoice history filters.',
    ],
  },
  {
    version: '0.1.7',
    title: 'Vehicle entry update',
    changes: [
      'Kept vehicle number required while removing the strict format validation.',
      'Removed the vehicle format helper text from the invoice form.',
    ],
  },
  {
    version: '0.1.6',
    title: 'Workspace header polish',
    changes: [
      'Added a cleaner branded workspace header with a subtitle and version pill.',
      'Kept the header compact without restoring the buyer, item, or row metrics.',
    ],
  },
  {
    version: '0.1.5',
    title: 'Workspace alignment update',
    changes: [
      'Improved workspace header and preview panel alignment.',
      'Removed the top-bar metrics from the logged-in workspace.',
      'Let the page handle invoice preview scrolling naturally.',
    ],
  },
  {
    version: '0.1.4',
    title: 'Workspace polish',
    changes: [
      'Updated typography and interactive feedback for daily use.',
      'Added accessible modal keyboard behavior and invoice success notifications.',
      'Replaced the large workspace hero with a compact summary bar.',
    ],
  },
  {
    version: '0.1.3',
    title: 'Changelog layout update',
    changes: [
      'Improved changelog scrolling and layout.',
      'Kept the update history controls visible while reading release notes.',
    ],
  },
  {
    version: '0.1.2',
    title: 'Stability update',
    changes: [
      'Made invoice generation publish files only after the invoice record is safely saved.',
      'Added rate validation to prevent negative taxable values.',
      'Fixed India-time invoice dates and date-only display across the app.',
    ],
  },
  {
    version: '0.1.1',
    title: 'Software update',
    changes: [
      'Added a version link to the login page.',
      'Added this changelog page for update history.',
      'Kept invoice history total amounts on one line in the desktop table.',
    ],
  },
  {
    version: '0.1.0',
    title: 'Initial workspace release',
    changes: [
      'Invoice generation with protected Excel and PDF downloads.',
      'E-way JSON support for generated invoice data.',
      'SQLite-backed buyer and item master data management.',
      'Invoice history, payment tracking, and admin-protected maintenance tools.',
    ],
  },
]

function ChangeLogScreen({ appVersion, onBackToLogin, backLabel = 'Back to login' }) {
  const latestEntry = changeLogEntries[0]

  return (
    <main className="login-shell changelog-page">
      <section className="changelog-shell">
        <aside className="changelog-hero">
          <div className="changelog-hero-top">
            <p className="eyebrow">Yash Bottles</p>
            <span>Latest</span>
          </div>

          <div className="changelog-title-block">
            <h1>Release notes</h1>
            <p>Track each software update for the invoice workspace.</p>
          </div>

          <div className="changelog-summary-grid" aria-label="Changelog summary">
            <div>
              <span>Current version</span>
              <strong>{appVersion}</strong>
            </div>
            <div>
              <span>Total updates</span>
              <strong>{changeLogEntries.length}</strong>
            </div>
            <div>
              <span>Latest update</span>
              <strong>{latestEntry.title}</strong>
            </div>
          </div>
        </aside>

        <section className="changelog-panel" aria-labelledby="changelog-title">
          <div className="panel-header panel-header-row">
            <div>
              <h2 id="changelog-title">Update history</h2>
              <p>Versioned notes for user-facing updates.</p>
            </div>
            <button className="secondary-button changelog-back" type="button" onClick={onBackToLogin}>
              {backLabel}
            </button>
          </div>

          <div className="changelog-timeline">
            {changeLogEntries.map((entry, index) => (
              <article className="changelog-entry" key={entry.version}>
                <div className="changelog-marker" aria-hidden="true" />
                <div className="changelog-entry-body">
                  <div className="changelog-entry-head">
                    <div>
                      <span>Version {entry.version}</span>
                      <h3>{entry.title}</h3>
                    </div>
                    {index === 0 ? <strong className="changelog-latest-pill">Current</strong> : null}
                  </div>
                  <ul>
                    {entry.changes.map((change) => (
                      <li key={change}>{change}</li>
                    ))}
                  </ul>
                </div>
              </article>
            ))}
          </div>
        </section>
      </section>
    </main>
  )
}

export { ChangeLogScreen }
